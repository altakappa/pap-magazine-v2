/**
 * PAP Magazine - Editorial Detail API
 * GET    /api/editorials/:id   → 에디토리얼 상세 조회 (공개)
 * PUT    /api/editorials/:id   → 에디토리얼 수정 (관리자)
 * DELETE /api/editorials/:id   → 에디토리얼 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { embedAndStoreEditorial } = require('../_lib/embeddings');
const { sendEmail, templates } = require('../_lib/email');
const { recordContentChange, diffFields, attachAuthorship } = require('../_lib/audit');
const { sendEditorialToTelegramSafe } = require('../_lib/telegram');

// QA #202 — fields we care about in the audit diff. Long opaque JSONB
// like `embedding` is intentionally excluded so the diff stays small
// and readable in the admin UI's "수정 이력" view.
const EDITORIAL_AUDIT_FIELDS = [
  'title','slug','status','published_date','scheduled_publish_at',
  'cover_image','thumbnail','tags','issue','description','description_en',
  'title_en','instagram_caption','seo_title','seo_description','og_image'
];

// QA #172 / QA #185 — Approval-email trigger.
// Fires from POST and PUT when the admin ticks "✉️ 저장 시 승인 메일 발송"
// in the editorial save modal. As of QA #185 the initial approval mail
// is auto-sent at REVIEW time (without publication day/month), so this
// path now acts as an explicit RE-SEND with the curated publication
// schedule + payment block. To keep it idempotent across accidental
// double-saves we still check approval_email_sent_at — but only block
// when the timestamp lies within the last 60 seconds. Older stamps
// from the review-time auto-send are intentionally overridden so the
// editor's deliberate tick on this checkbox always reaches the inbox.
// Conditions to actually send:
//   1) editorial has a source_submission_id (was staged from a submission)
//   2) approval_email_sent_at is older than 60s OR null
//   3) we can look up the submitter's email
async function _maybeSendApprovalEmail(editorialRow, opts) {
  if (!editorialRow || !editorialRow.id) return;
  if (!opts || !opts.sendApprovalEmail) return;
  if (!editorialRow.source_submission_id) return;
  if (editorialRow.approval_email_sent_at) {
    const lastMs = new Date(editorialRow.approval_email_sent_at).getTime();
    if (!isNaN(lastMs) && (Date.now() - lastMs) < 60_000) {
      // Stamped within the last minute — almost certainly a debounce of
      // a save that already triggered this same path. Skip to avoid
      // duplicate sends, but allow legitimate resends after the cool-off.
      return;
    }
  }

  try {
    const { data: submission } = await supabaseAdmin
      .from('submissions')
      .select('user_id, title')
      .eq('id', editorialRow.source_submission_id)
      .single();
    if (!submission || !submission.user_id) return;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, display_name, language, email_language')
      .eq('id', submission.user_id)
      .single();
    if (!profile || !profile.email) return;

    const lang = profile.email_language || profile.language || 'en';
    const tpl = templates.submissionReviewComplete(
      { name: profile.display_name || '' },
      // Use the editorial's CURRENT title — admin may have renamed it
      // since the submission was filed.
      { title: editorialRow.title || submission.title },
      lang,
      'approved',
      { approvalDay: opts.approvalDay || '', approvalMonth: opts.approvalMonth || '' }
    );
    const result = await sendEmail(profile.email, tpl);
    // QA #214 — record the result in approval_email_status so the admin
    // UI can render a precise badge. 'sent' on success, 'failed' on
    // mailer error/skip with a stored reason for debugging.
    if (result && result.sent) {
      await supabaseAdmin
        .from('editorials')
        .update({
          approval_email_sent_at: new Date().toISOString(),
          approval_email_status: 'sent',
          approval_email_failed_reason: null,
        })
        .eq('id', editorialRow.id);
    } else {
      const reason = (result && (result.message || result.reason)) || 'mailer returned no success flag';
      await supabaseAdmin
        .from('editorials')
        .update({
          approval_email_status: 'failed',
          approval_email_failed_reason: String(reason).slice(0, 500),
        })
        .eq('id', editorialRow.id);
    }
  } catch (err) {
    console.error('[editorial approval-email] send failed:', err && err.message);
    // Best-effort: stamp the failure on the row so the editor sees the
    // red badge instead of an ambiguous "이미 발송됨" placeholder.
    try {
      await supabaseAdmin
        .from('editorials')
        .update({
          approval_email_status: 'failed',
          approval_email_failed_reason: String(err && err.message || 'unknown').slice(0, 500),
        })
        .eq('id', editorialRow.id);
    } catch(_){}
  }
}

// Re-embed only when fields that drive the embedding text actually change.
// Saves an OpenAI call (and a DB write) on routine admin edits like fixing
// a typo in `gallery` or toggling status.
const EMBED_TRIGGERS = ['title', 'description', 'tags'];
function shouldReembed(updates) {
  for (const k of EMBED_TRIGGERS) {
    if (Object.prototype.hasOwnProperty.call(updates, k)) return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      // QA #163 — reverse-fan in the films that point at this editorial
      // via films.related_editorial_id so the detail page can render a
      // "Related Films" section without a second round-trip. Limit to
      // published films and a sane projection (id/slug/title/thumbnail/
      // youtube_id/published_date) so the response stays small even when
      // a single editorial gets multiple linked films over time.
      // 2026-07-22 QA(히어로 배너 공백) — UUID 가 아니면 slug 로 조회를 허용한다.
      // 딥링크(?ed=<slug>)가 클라이언트 카탈로그에 아직 없는 에디토리얼을 서버에서
      // 직접 가져올 수 있는 유일한 경로. slug 조회는 published 만 노출(드래프트 유출 방지;
      // 관리자·상세 하이드레이트는 기존대로 UUID 를 쓴다).
      const _isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
      let q = supabaseAdmin
        .from('editorials')
        .select('*, related_films:films!related_editorial_id(id,slug,title,thumbnail_url,youtube_id,published_date,status)');
      q = _isUuid ? q.eq('id', id) : q.eq('slug', String(id || '').toLowerCase()).eq('status', 'published');
      const { data, error } = await q.single();

      if (error || !data) {
        return res.status(404).json({ error: 'Editorial not found' });
      }

      // Filter out unpublished films before sending — service-role bypasses
      // RLS so we have to enforce visibility here. (Doing it post-fetch
      // keeps the join shape simple — Supabase doesn't yet support an
      // .eq() on the joined table directly when there's no explicit
      // relationship hint.)
      if (Array.isArray(data.related_films)) {
        data.related_films = data.related_films
          .filter(f => f && f.status === 'published')
          .sort((a, b) => String(b.published_date || '').localeCompare(String(a.published_date || '')));
      }

      // QA #202 — attach denormalised authorship objects so the admin
      // detail modal can render "작성: X · 마지막 수정: Y" without a
      // per-row second fetch.
      await attachAuthorship([data]);

      // 2026-07-26 — 다국어 리더: seo_translations(editorial) 의 제목·요약 번역을
      // title_i18n/description_i18n 로 실어 리더가 활성 언어로 요약을 렌더한다.
      // (에디토리얼 본문은 미번역 — 사진 중심. 제목 표시는 키 구조상 원본 유지.)
      try {
        const { data: _trs } = await supabaseAdmin
          .from('seo_translations')
          .select('lang, title, description')
          .eq('kind', 'editorial')
          .eq('content_id', data.id);
        const _ti = {}, _di = {};
        if (data.title) _ti.ko = data.title;
        if (data.title_en) _ti.en = data.title_en;
        if (data.description) _di.ko = data.description;
        if (data.description_en) _di.en = data.description_en;
        for (const r of (_trs || [])) {
          if (r && r.title) _ti[r.lang] = r.title;
          if (r && r.description) _di[r.lang] = r.description;
        }
        data.title_i18n = _ti;
        data.description_i18n = _di;
      } catch (_) { /* best-effort */ }

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Editorial GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch editorial' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      // Phase 4: scheduled_publish_at, seo_*, og_image, title_en, description_en
      // are part of the allowlist so the admin form can save them.
      const allowed = [
        'title', 'slug', 'cover_image', 'published_date', 'url', 'tags',
        'issue', 'thumbnail', 'gallery', 'credits', 'fashion', 'status', 'description',
        'scheduled_publish_at', 'seo_title', 'seo_description', 'og_image',
        'title_en', 'description_en',
        // QA #204 — dedicated IT translation slot (was previously only
        // surfaced inside the instagram_caption blob).
        'description_it',
        // QA #170 — editor-tunable Instagram caption (auto-seeded at
        // submission approval; admin can hand-edit before publishing).
        'instagram_caption',
        // 참여 증폭 2.0 (2026-07) — 원본 IG 게시물 permalink.
        'source_instagram_url',
        // QA #214 — persist approval-email curator settings so the
        // editor's day/month inputs survive a save+reopen cycle.
        // approval_email_status flips to 'pending' here, then the
        // _maybeSendApprovalEmail helper bumps it to 'sent'/'failed'.
        'approval_email_day', 'approval_email_month',
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      // QA #301 — credits 에 들어온 instagram 의 @ 자동 보강 + 잘못 매핑 정정.
      // 헬퍼는 array 일 때만 작동, 비 array 면 그대로 통과.
      try {
        const { normalizeCreditsArray } = require('../_lib/credits');
        if (Array.isArray(updates.credits)) {
          updates.credits = normalizeCreditsArray(updates.credits);
        }
      } catch (_) {}
      // QA #214 — map review-modal payload keys (approval_day, approval_month)
      // onto the persisted column names so a single payload covers both
      // the mailer (which reads the camelCase variants) and the DB.
      if (req.body.approval_day !== undefined && updates.approval_email_day === undefined) {
        updates.approval_email_day = req.body.approval_day;
      }
      if (req.body.approval_month !== undefined && updates.approval_email_month === undefined) {
        updates.approval_email_month = req.body.approval_month;
      }

      // QA #202 — pull the FULL prior row up-front so we can both
      // (a) detect draft→published transition and (b) compute an
      // audit diff against what the editor actually changed.
      let priorStatus = null;
      let priorRow = null;
      {
        const { data: prior } = await supabaseAdmin
          .from('editorials')
          .select('*')
          .eq('id', id)
          .single();
        priorRow = prior || null;
        priorStatus = prior ? prior.status : null;
        if (updates.status !== undefined) {
          const becomingPublished = updates.status === 'published' && priorStatus !== 'published';
          if (becomingPublished && updates.published_date === undefined && (!prior || !prior.published_date)) {
            updates.published_date = new Date().toISOString();
          }
        }
        // QA #214 — when the curator unticks the send checkbox AND a
        // previous failed send is on file, treat the save as a deliberate
        // "reset for retry" so the failed badge clears. We never touch
        // status when the box stays ticked — _maybeSendApprovalEmail
        // handles the sent/failed transition based on the mailer result.
        if (req.body.send_approval_email === false && prior && prior.approval_email_status === 'failed') {
          updates.approval_email_status = 'pending';
          updates.approval_email_failed_reason = null;
        }
      }

      // QA #197 — stamp admin_edited_at on every admin PUT. This is what
      // lets the Drafts tab tell apart "admin actually curated this" from
      // "auto-staged at submission approval, never touched". The admin's
      // draft list query reads (source_submission_id IS NULL OR
      // admin_edited_at IS NOT NULL); writing here flips the second arm
      // true so the row starts appearing in 임시저장 from now on.
      updates.admin_edited_at = new Date().toISOString();
      // QA #202 — record who pressed Save. created_by stays untouched
      // (only POST sets it); updated_by gets the current admin.
      updates.updated_by = user.id;

      const { data, error } = await supabaseAdmin
        .from('editorials')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // QA #202 — audit ledger entry with a compact diff of what
      // actually changed. The publish/unpublish action is split out
      // because the UI wants to highlight status transitions
      // separately from generic edits.
      try {
        const diff = diffFields(priorRow, updates, EDITORIAL_AUDIT_FIELDS);
        let action = 'update';
        let summary;
        if (updates.status && priorStatus && updates.status !== priorStatus) {
          if (updates.status === 'published')         { action = 'publish';   summary = `공개 전환 (이전: ${priorStatus})`; }
          else if (priorStatus === 'published')       { action = 'unpublish'; summary = `${updates.status} 으로 비공개 전환`; }
        }
        await recordContentChange({
          content_type: 'editorial',
          content_id: id,
          action,
          actor: user,
          summary,
          diff,
        });
      } catch(_){}

      // Re-embed when the admin changed embedding-relevant text OR when the
      // editorial is going public for the first time (drafts staged from
      // submissions never got an initial embed — we skip that to avoid
      // indexing half-baked work).
      const becomingPublished = updates.status === 'published' && priorStatus !== 'published';
      if (shouldReembed(updates) || becomingPublished) {
        try { await embedAndStoreEditorial(data); }
        catch (e) { console.warn('[editorial PUT] re-embed failed', e && e.message); }
      }

      // 새 에디토리얼이 처음 공개되는 순간, 인스타그램용(5:4 · 아래 로고) 이미지들
      // = 저장된 cover_image + gallery 를 텔레그램으로 자동 전송한다.
      // await 로 두어 serverless 함수가 응답 후 종료되며 전송이 잘려나가는 것을
      // 방지한다. Safe 래퍼라 실패해도 예외를 던지지 않아 발행은 항상 성공한다.
      // (env TELEGRAM_BOT_TOKEN/CHAT_ID 미설정 시 즉시 skip.)
      if (becomingPublished) {
        await sendEditorialToTelegramSafe(data);
      }

      // QA #172 — fire the approval email when the admin ticked the
      // checkbox. Idempotent: re-saving with the box still ticked won't
      // resend because approval_email_sent_at is now stamped.
      await _maybeSendApprovalEmail(data, {
        sendApprovalEmail: req.body.send_approval_email === true,
        approvalDay: req.body.approval_day || '',
        approvalMonth: req.body.approval_month || '',
      });

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Editorial PUT error:', err);
      return res.status(500).json({ error: 'Failed to update editorial' });
    }
  }

  // DELETE: 삭제
  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      // QA #202 — capture the row before destruction so the audit row
      // has a meaningful "삭제된 콘텐츠 제목" summary.
      let priorTitle = null;
      try {
        const { data: prior } = await supabaseAdmin
          .from('editorials')
          .select('title')
          .eq('id', id)
          .single();
        priorTitle = prior ? prior.title : null;
      } catch(_){}

      const { error } = await supabaseAdmin
        .from('editorials')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await recordContentChange({
        content_type: 'editorial',
        content_id: id,
        action: 'delete',
        actor: user,
        summary: priorTitle ? `삭제: ${priorTitle}` : '에디토리얼 삭제',
      });

      return res.status(200).json({ message: 'Editorial deleted' });
    } catch (err) {
      console.error('Editorial DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete editorial' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
