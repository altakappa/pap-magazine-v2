/**
 * POST /api/submissions       — Create new submission (user, JSON body with pre-uploaded URLs)
 * GET  /api/submissions        — List all submissions (admin, with ?status=&page=)
 *
 * Upload flow (two-step, direct-to-Supabase):
 *   1. Client compresses images and requests signed upload URLs via
 *      POST /api/submissions/upload-url
 *   2. Client PUTs each file directly to Supabase Storage (bypasses Vercel's
 *      4.5 MB request-body ceiling entirely).
 *   3. Client POSTs submission metadata here with the resulting public URLs.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { normalizeGenres } = require('../_lib/submissionCategories');
const { classifySubmissionType, looksMissingCredit } = require('../_lib/submissionType');
const { findNonLatin } = require('../_lib/latinOnly');
const { feeForType } = require('../_lib/submissionPayment');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
// 2026-08-03 — 관리자 목록에 '무료체험 중 · 전환 D-N' 배지를 달기 위한 공용 판정.
// 서브미션은 '접수 자동 보류'를 하지 않는다(무료회원 투고가 매거진의 핵심 입력이라
// 파이프라인을 막으면 안 됨). 배지로 표시만 하고 판단은 에디터가 한다.
const { classifyPeriod } = require('../_lib/trialWindow');

const BUCKET = 'submissions';

/**
 * Build the `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{user.id}/`
 * prefix that every submitted URL must start with. This guarantees the
 * caller cannot register URLs pointing at another user's folder, a different
 * bucket, or an arbitrary third-party host.
 */
function userPathPrefix(userId) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const safeId = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon';
  return `${base}/storage/v1/object/public/${BUCKET}/${safeId}/`;
}

function isValidOwnedUrl(url, prefix) {
  if (typeof url !== 'string' || !url) return false;
  if (!url.startsWith(prefix)) return false;
  // Reject path traversal and accidental query-string abuse
  if (url.indexOf('..') !== -1) return false;
  return true;
}

function sanitizeUrlList(list, prefix) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const u of list) {
    if (isValidOwnedUrl(u, prefix)) out.push(u);
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (rateLimit(req, res, RATE_LIMITS.upload)) return;

  // ── POST: Create submission (JSON, with pre-uploaded URLs) ──
  if (req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      // Vercel parses JSON automatically; normalize defensively.
      let body = req.body;
      if (!body || typeof body === 'string') {
        try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
      }

      const data = body.data || {};
      const prefix = userPathPrefix(user.id);

      // Validate required fields
      if (!data.title || !String(data.title).trim()) {
        return res.status(400).json({ message: 'Title is required' });
      }
      if (!data.genre || !Array.isArray(data.genre) || data.genre.length === 0) {
        return res.status(400).json({ message: 'At least one genre is required' });
      }

      // FIX-1 (2026-07-19) — persist the selected category into the dedicated
      // `submissions.category` column. Historically the genre pick lived ONLY
      // inside the description JSON, so `category` was NULL for every row and
      // admin analytics (SELECT category, count(*) ... GROUP BY 1) was blind.
      // Whitelist against the 8 buttons in submission.html to reject arbitrary
      // values; store the primary (first) pick in `category` and keep the full
      // normalized list in description.genre for the multi-select UI. The
      // whitelist + normalization live in api/_lib/submissionCategories.js so
      // the rule is regression-tested against the real code.
      const normalizedGenres = normalizeGenres(data.genre);
      if (normalizedGenres.length === 0) {
        return res.status(400).json({ message: 'At least one valid category is required' });
      }
      const primaryCategory = normalizedGenres[0];

      // Validate + scope URLs to the caller's own folder
      const lookUrls = sanitizeUrlList(body.lookUrls, prefix);
      const additionalUrls = sanitizeUrlList(body.additionalUrls, prefix);

      if (lookUrls.length + additionalUrls.length === 0) {
        return res.status(400).json({ message: 'No valid image URLs provided' });
      }

      // Reject if any submitted URL was stripped for being out-of-scope — the
      // client shouldn't ever send those, so flag it loudly for easier debug.
      const submittedTotal =
        (Array.isArray(body.lookUrls) ? body.lookUrls.length : 0) +
        (Array.isArray(body.additionalUrls) ? body.additionalUrls.length : 0);
      const acceptedTotal = lookUrls.length + additionalUrls.length;
      if (acceptedTotal < submittedTotal) {
        console.warn(
          '[submissions] dropped %d out-of-scope URLs (user=%s)',
          submittedTotal - acceptedTotal, user.id
        );
        return res.status(400).json({
          message: 'One or more image URLs do not belong to this user',
        });
      }

      // Validate optional video URL (Dropbox / WeTransfer / Swisstransfer / etc.)
      let videoUrl = typeof data.videoUrl === 'string' ? data.videoUrl.trim() : '';
      if (videoUrl) {
        try {
          const u = new URL(videoUrl);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') videoUrl = '';
        } catch (_) {
          videoUrl = '';
        }
      }

      // Flatten credits.photographer to a single display string
      const photographerCredit = Array.isArray(data.credits?.photographer)
        ? data.credits.photographer.join(', ')
        : (data.credits?.photographer || '');

      // Per-look fashion credits captured by the submission UI. `looks` is
      // [{ n, items: [{ type, brand, instagram }] }] and `lookImageMap`
      // mirrors `lookUrls` index-for-index, mapping each look image to the
      // look number it belongs to so the admin review modal can show the
      // brand crew per image.
      const looks = Array.isArray(data.looks) ? data.looks : [];
      const lookImageMap = Array.isArray(data.lookImageMap) ? data.lookImageMap : [];
      // Submission-type classification (2026-07-19) — DETECT + STORE only, no
      // payment/email. Recomputed AUTHORITATIVELY here from the persisted
      // looks + lookImageMap so the stored type can't be spoofed by the client
      // (the form computes its own copy only for on-page guidance). Shared
      // helper (api/_lib/submissionType.js) keeps front/back rules in lockstep
      // and is regression-tested. 'free' | 'paid_few_looks' | 'branded'.
      // 신규 제출/수정이므로 SPA 제외는 현재 시각 기준으로 판정된다
      // (submissionType.js:spaRuleApplies — 발효일 이전 기존 행은 소급 안 됨).
      // 브랜드명·핸들은 영문(라틴)으로만 받는다 (2026-08-26 도메니코 지시).
      // 프론트(pap-name-validator.js)가 이미 막고 있지만 그것뿐이라, API 를
      // 직접 호출하면 비라틴 브랜드명이 그대로 저장됐다. 브랜드 집계와
      // 크레딧 수정이 브랜드 문자열에 의존하므로 서버가 진실원천이어야 한다.
      // 사람 이름(team)에는 적용하지 않는다 — 이번 규칙의 대상은 브랜드다.
      const _brandEntries = [];
      looks.forEach(function (lk, li) {
        const items = (lk && Array.isArray(lk.items)) ? lk.items : [];
        items.forEach(function (it, ii) {
          if (!it) return;
          const label = 'Look ' + ((lk && lk.n) || (li + 1)) + ' item ' + (ii + 1);
          if (it.brand) _brandEntries.push({ label: label + ' brand', value: it.brand });
          if (it.instagram) _brandEntries.push({ label: label + ' handle', value: it.instagram });
        });
      });
      const _nonLatin = findNonLatin(_brandEntries);
      if (_nonLatin.length) {
        return res.status(400).json({
          code: 'BRAND_LATIN_ONLY',
          message: 'Brand names and handles must be written in English (Latin letters): '
            + _nonLatin.map(function (x) { return x.value; }).join(', '),
          violations: _nonLatin,
        });
      }

      const { submissionType } = classifySubmissionType(looks, lookImageMap);
      // 2026-07-21 (도메니코 지시) — 모든 룩은 최소 1개 크레딧(브랜드 또는 인스타)이
      // 있어야 제출/재제출 가능. 과거엔 강제하지 않아 룩 크레딧 없이 통과됐다(예: Marooned).
      const _missingCreditLooks = looksMissingCredit(looks);
      if (looks.length && _missingCreditLooks.length) {
        return res.status(400).json({
          code: 'LOOK_CREDIT_REQUIRED',
          message: 'Each look needs at least one credit (brand or Instagram). Missing: Look ' + _missingCreditLooks.join(', '),
          missingLooks: _missingCreditLooks,
        });
      }
      // QA #168 — also persist the STRUCTURED team array
      // [{ role, name, instagram, website }, …]. data.credits is a lossy
      // flat-string view kept for legacy consumers; review.js stage-as-
      // editorial now reads `team` directly so it can populate editorial
      // .credits in its native shape ({roles[], name, instagram, website})
      // without re-parsing "Name (@handle)" strings.
      const team = Array.isArray(data.team) ? data.team : [];

      const { data: submission, error } = await supabaseAdmin
        .from('submissions')
        .insert({
          user_id: user.id,
          title: data.title || 'Untitled',
          category: primaryCategory,
          description: JSON.stringify({
            genre: normalizedGenres,
            artistStatement: data.artistStatement || '',
            credits: data.credits || {},
            team,
            models: data.models || [],
            coverImageIndex: data.coverImageIndex || 0,
            contactEmail: data.contactEmail || '',
            contactName: data.contactName || '',
            photographerCredit,
            videoUrl,
            looks,
            lookImageMap,
            submissionType,
          }),
          file_urls: [...lookUrls, ...additionalUrls],
          status: 'pending',
          // 2026-08-12 승인후결제 — 유료 유형은 결제 승인을 받아야 심사에 오른다.
          // 무료 유형은 청구 대상이 아니므로 'none' 그대로: 결제 API 가 닿지 않는다.
          // 'awaiting_authorization' 은 review.js 가 승인을 막는 신호이기도 하다
          // (승인 없이 게재되면 €790 을 영영 못 받는다).
          payment_status: feeForType(submissionType) ? 'awaiting_authorization' : 'none',
        })
        .select()
        .single();

      if (error) {
        console.error('Submissions insert failed:', error);
        throw error;
      }

      /* 접수 확인 메일 (2026-08-26 도메니코 지시 — 모든 안내를 회원 언어로).
       * 과거에는 '메일 없음'이 의도된 결정이었지만(스팸함 우려·사이트 재방문
       * 유도), 접수 메일에 프리미엄 안내를 싣는 퍼널(8/25)과 함께 방침 변경.
       * 언어는 resolveEmailLang(뉴스레터 설정 > 사이트 언어 > 국가 > en).
       * ★ 반드시 await — fire-and-forget 은 서버리스 프리즈로 실제 발송이
       * 안 된다(승인 메일 0/35 실측 전례). 실패해도 접수는 막지 않는다. */
      try {
        const { data: _prof } = await supabaseAdmin
          .from('profiles')
          .select('email, display_name, language, email_language, country')
          .eq('id', user.id)
          .single();
        if (_prof && _prof.email) {
          const _lang = resolveEmailLang(_prof);
          await sendEmail(_prof.email, templates.submissionReceived(
            { name: _prof.display_name || '' }, { title: submission.title }, _lang));
        }
      } catch (_e) {
        console.error('[submissions] 접수 메일 실패(접수는 저장됨):', (_e && _e.message) || _e);
      }

      return res.status(201).json({ submission });
    } catch (error) {
      try {
        console.error('Create submission error:', {
          name: error && error.name,
          message: error && error.message,
          code: error && error.code,
          details: error && error.details,
          hint: error && error.hint,
          stack: error && error.stack,
        });
      } catch (_) { console.error('Create submission error (raw):', error); }

      // 2026-07-28 — 제출 저장 실패를 즉시 텔레그램으로 알린다. Vercel 로그가
      // 24h 뒤 사라지기 전에 원인(세션 만료·DB 제약 등)을 잡기 위한 운영자
      // 대면 알림이라 상세를 실어도 된다(회원 응답에는 여전히 원문 미노출).
      // 실패해도 응답을 막지 않도록 try/catch 로 감싼다.
      try {
        await sendTextToTelegramSafe(
          '🚨 서브미션 저장 실패\nuser=' + (user && user.id || '') +
          '\ncode=' + (error && error.code || '') +
          '\nmsg=' + String((error && error.message) || '').slice(0, 300)
        );
      } catch (_) { /* 알림 실패는 무시 */ }

      // 회원 응답: 원문 노출 금지 — 일반 안내 + 분류용 code 만.
      return res.status(500).json({
        message: 'Failed to create submission. If this keeps happening, contact contact@pap-magazine.com',
        code: 'create_failed',
      });
    }
  }

  // ── GET: List all submissions (admin) ──
  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    try {
      // QA #174 — perPage was 20, which silently hid every submission
      // past the first page from the admin (no pagination UI was wired
      // up either). Bumped to 50 so a year's worth of editorial entries
      // fits on a single screen for most months; the new pagination UI
      // below covers the overflow when it eventually happens.
      const { status, page = 1, limit: rawLimit } = req.query;
      const perPage = Math.min(Math.max(1, parseInt(rawLimit) || 50), 200);
      const offset = (parseInt(page) - 1) * perPage;

      // Don't use PostgREST embed here: `submissions.user_id` FKs to
      // `auth.users`, not `profiles`, so the relationship isn't always
      // inferrable. Also, subscription plan lives on its own table
      // (`subscriptions.plan`), not on `profiles`. Fetch everything in
      // parallel side queries and stitch the result together in Node.
      let query = supabaseAdmin
        .from('submissions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + perPage - 1);

      // 2026-08-17 (도메니코 지적) — 유료 유형(branded 등)인데 결제(승인)를
      // 마치지 않은 서브미션이 심사 리스트에 올라왔다. 결제 미완료 상태
      // (awaiting_authorization: 페이팔 승인 전 / awaiting_payment: 구식 값)는
      // 리스트에서 제외한다. 'none'(무료 유형)·'authorized'·'paid'·'refunded'
      // 는 그대로 보인다. payment_status 가 NULL 인 과거 행도 살아남도록
      // is.null 을 or 로 함께 건다 (not.in 단독은 NULL 행을 삼킨다).
      query = query.or(
        'payment_status.is.null,payment_status.not.in.(awaiting_authorization,awaiting_payment)'
      );

      // QA #175 — "resubmitted" is a synthetic filter that means
      // "pending AND already came back from a revision round". Maps to
      // (status='pending' AND resubmitted_at IS NOT NULL).
      // QA #179 — two more synthetic filters tied to the linked editorial:
      //   uploaded       → status='approved' AND linked_editorial.status='published'
      //   final_approved → status='approved' AND (no linked_editorial OR linked_editorial.status='draft')
      // We resolve those at the application layer after the query because
      // PostgREST embed-side filtering is awkward to combine with the
      // existing count / pagination contract.
      const isVirtual = status === 'uploaded' || status === 'final_approved';
      if (status === 'resubmitted') {
        query = query.eq('status', 'pending').not('resubmitted_at', 'is', null);
      } else if (isVirtual) {
        // Pull all approved rows; we'll narrow down in memory after the
        // linked_editorial embed lands. The page contract still applies —
        // pagination is computed on the post-filter list below.
        query = query.eq('status', 'approved');
      } else if (status) {
        query = query.eq('status', status);
      }

      const { data: submissions, count, error } = await query;

      if (error) throw error;

      // QA #179 — fan-in the linked editorial via source_submission_id so
      // the admin list can display "최종승인" vs "업로드완료" badges
      // (approved + draft vs approved + published). Single side query
      // keyed by submission id — keeps the hot list query cheap.
      const submissionIds = (submissions || []).map(s => s.id).filter(Boolean);
      let linkedEditorialBySubId = {};
      if (submissionIds.length > 0) {
        // QA #189 — also pull scheduled_publish_at so the MY SUBMISSIONS
        // approval block can render "around the X of Month" from the
        // editor's scheduled publish date instead of asking the admin
        // to type it into the review modal.
        const { data: editorialRows } = await supabaseAdmin
          .from('editorials')
          .select('id, slug, status, published_date, scheduled_publish_at, source_submission_id')
          .in('source_submission_id', submissionIds);
        if (Array.isArray(editorialRows)) {
          // QA #290 — published editorial을 우선 매칭. 같은 submission에 draft + published
          // 두 editorial이 모두 존재하는 경우, 마지막 row가 winner가 되면 published됐는데도
          // 최종 승인 목록에 잘못 노출되는 버그(같은 submission이 두 상태에 동시 노출).
          for (const er of editorialRows) {
            if (!er || !er.source_submission_id) continue;
            const existing = linkedEditorialBySubId[er.source_submission_id];
            // Prefer published > scheduled-future > draft.
            if (!existing) {
              linkedEditorialBySubId[er.source_submission_id] = er;
            } else if (er.status === 'published' && existing.status !== 'published') {
              linkedEditorialBySubId[er.source_submission_id] = er;
            }
          }
        }
      }

      // QA #213 — title-based fallback link. If a submission has no
      // linked editorial via source_submission_id (e.g. the editorial
      // was created manually before QA #115 wired up that column), try
      // matching on a normalised title. This way the admin list still
      // shows "업로드 완료" for published rows whose link was lost,
      // and also self-heals the data by stamping source_submission_id
      // back onto the editorial so the next request hits the fast path.
      const unlinkedSubs = (submissions || [])
        .filter(s => s && s.status === 'approved' && !linkedEditorialBySubId[s.id] && s.title)
        .map(s => ({ id: s.id, normTitle: String(s.title).trim().toLowerCase() }));
      if (unlinkedSubs.length > 0) {
        const candidateTitles = unlinkedSubs.map(u => u.normTitle);
        const { data: candidateEditorials } = await supabaseAdmin
          .from('editorials')
          .select('id, slug, status, published_date, scheduled_publish_at, source_submission_id, title')
          .is('source_submission_id', null);
        if (Array.isArray(candidateEditorials)) {
          const byTitle = {};
          for (const er of candidateEditorials) {
            if (!er || !er.title) continue;
            const k = String(er.title).trim().toLowerCase();
            // QA #290 — title 매칭에서도 published 우선. 같은 제목으로
            // draft와 published가 둘 다 있다면 published를 link해서
            // submission이 '업로드 완료'로 분류되도록.
            const existing = byTitle[k];
            if (!existing) {
              byTitle[k] = er;
            } else if (er.status === 'published' && existing.status !== 'published') {
              byTitle[k] = er;
            }
          }
          // Pair each unlinked submission with a same-title editorial,
          // backfill source_submission_id, and seed the lookup map so
          // _deriveDisplayStatus picks it up below.
          const repairs = [];
          for (const u of unlinkedSubs) {
            const match = byTitle[u.normTitle];
            if (!match) continue;
            linkedEditorialBySubId[u.id] = match;
            repairs.push({ ed_id: match.id, sub_id: u.id });
          }
          // Fire-and-forget self-heal: write source_submission_id back
          // so subsequent requests don't pay the title-scan cost.
          for (const r of repairs) {
            supabaseAdmin
              .from('editorials')
              .update({ source_submission_id: r.sub_id })
              .eq('id', r.ed_id)
              .is('source_submission_id', null)
              .then(({ error }) => {
                if (error) console.warn('[QA213 self-heal] editorial', r.ed_id, error.message);
              });
          }
        }
      }

      // Hydrate submitter profile + subscription plan via side queries.
      const userIds = Array.from(new Set(
        (submissions || []).map(s => s.user_id).filter(Boolean)
      ));

      let profilesById = {};
      let plansById = {};
      // 무료체험 배지용 원본 구독 행 (user_id → subscriptions row)
      let subRowByUser = {};

      if (userIds.length > 0) {
        const [profRes, subRes] = await Promise.all([
          supabaseAdmin
            .from('profiles')
            .select('id, display_name, email, subscription_plan')
            .in('id', userIds),
          supabaseAdmin
            .from('subscriptions')
            .select('user_id, plan, status, current_period_start, current_period_end')
            .in('user_id', userIds),
        ]);

        if (Array.isArray(profRes?.data)) {
          for (const p of profRes.data) profilesById[p.id] = p;
        }
        if (Array.isArray(subRes?.data)) {
          // Prefer an `active` subscription over any other status.
          for (const s of subRes.data) {
            const existing = plansById[s.user_id];
            if (!existing || s.status === 'active') {
              plansById[s.user_id] = s.plan;
              subRowByUser[s.user_id] = s;
            } else if (!subRowByUser[s.user_id]) {
              subRowByUser[s.user_id] = s;
            }
          }
        }
      }

      // QA #179 — derive display_status. Five-state workflow surfaced to
      // the admin: 대기중 / 보완요청 / 최종승인 / 업로드완료 / 거절,
      // plus the existing 보완완료 (resubmitted) badge.
      function _deriveDisplayStatus(s, le) {
        if (s.status === 'rejected') return 'rejected';
        if (s.status === 'revision') return 'revision';
        if (s.status === 'pending') {
          return s.resubmitted_at ? 'resubmitted' : 'pending';
        }
        if (s.status === 'approved') {
          if (le && le.status === 'published') return 'uploaded';
          return 'final_approved';
        }
        return s.status;
      }

      const hydrated = (submissions || []).map(s => {
        const p = profilesById[s.user_id] || {};
        const le = linkedEditorialBySubId[s.id] || null;
        return {
          ...s,
          submitterName: p.display_name || null,
          submitterEmail: p.email || null,
          submitterPlan: plansById[s.user_id] || null,
          submitterGrade: (p.subscription_plan || 'free'),
          // { isTrial, chargeDateKst, daysToCharge, label } — 없으면 null
          submitterTrial: subRowByUser[s.user_id] ? classifyPeriod(subRowByUser[s.user_id]) : null,
          linked_editorial: le,
          display_status: _deriveDisplayStatus(s, le),
        };
      });

      // Virtual-filter narrow-down. We pre-filtered to status='approved'
      // server-side; here we drop the rows that don't match the
      // requested view. Pagination total recalculated so the page UI
      // counts the visible subset, not the parent approved pool.
      const filteredList = isVirtual
        ? hydrated.filter(r => r.display_status === status)
        : hydrated;
      const finalTotal = isVirtual ? filteredList.length : count;
      const finalTotalPages = Math.max(1, Math.ceil(finalTotal / perPage));

      return res.status(200).json({
        submissions: filteredList,
        total: finalTotal,
        page: parseInt(page),
        perPage,
        totalPages: finalTotalPages,
      });
    } catch (error) {
      // 2026-08-03 — 원래는 Supabase/Postgres 원문 오류를 응답 body 에 그대로
      // 붙여 보냈다(message/code/details). 이 엔드포인트는 관리자 전용이 아니라
      // 일반 사용자도 자기 서브미션 목록을 받아가는 경로라, 실패 시 테이블·컬럼명과
      // Postgres 오류코드가 그대로 클라이언트로 새어나갔다. 진단 정보는 서버
      // 로그(console.error)에만 남기고, 응답은 일반 메시지로 통일한다.
      try {
        console.error('List submissions error:', {
          name: error && error.name,
          message: error && error.message,
          code: error && error.code,
          details: error && error.details,
          hint: error && error.hint,
        });
      } catch (_) { console.error('List submissions error (raw):', error); }

      return res.status(500).json({
        message: 'Failed to fetch submissions',
      });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
