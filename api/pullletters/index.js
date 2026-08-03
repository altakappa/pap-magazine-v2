/**
 * POST /api/pullletters
 *   Multipart form-data from /frontend/pullletter.html.
 *
 *   Fields (all under `data` JSON field):
 *     photographer:  { name, instagram, portfolio }   — REQUIRED
 *     stylist:       { name, instagram, portfolio }   — REQUIRED
 *     videographer:  { name, instagram, portfolio }   — optional
 *     contact:       { name, email }                  — REQUIRED
 *     requestText:   string (short summary)           — optional
 *
 *   Files:
 *     moodboard:    image file(s)  — optional (2026-07-22 통합: 무드보드·촬영
 *                   컨셉·팀 구성은 촬영시안 PDF 하나에 포함. 과거 요청 호환용)
 *     proposal_pdf: PDF file       — REQUIRED        — uploaded to `pullletters` bucket
 *
 *   Premium-only (server-side enforcement); rejects non-premium requesters
 *   regardless of any client-side bypass.
 *
 * GET /api/pullletters
 *   Admin-only list. Optional ?status= filter.
 */

const fs = require('fs');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { parseForm, uploadFiles } = require('../_lib/upload');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const { hasActivePremium } = require('../_lib/subscriptionAccess');
// 2026-08-03 — 무료체험 어뷰징 방지(시윤 1·2·4단계). 체험 중 접수 건은 자동 '보류',
// 관리자 목록에 '무료체험 중 · 전환 D-N' 배지, 월 1건 상한.
const { trialInfoForUser, trialInfoByUserIds, kstDateStr } = require('../_lib/trialWindow');

// 풀레터는 프리미엄 회원 1인당 '월 1건'. 발급은 실물 대여 협조를 동반하는
// 고비용 서비스라 무제한이 될 수 없다. (프론트 문구도 같은 숫자를 쓴다)
const PULLLETTER_MONTHLY_LIMIT = 1;
const { verifySignature, SNIFF_BYTES } = require('../_lib/fileSignature');

module.exports.config = { api: { bodyParser: false } };

// Sanitize role-like strings for storage paths
function safeId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon';
}

// 보안(2026-07-26 감사 A-1) — 회원이 입력한 URL 은 반드시 http/https 여야 한다.
// 이 값들은 관리자 검토 화면에서 <a href> 로 렌더되므로, `javascript:` /
// `data:` 스킴을 저장하게 두면 관리자가 링크를 클릭하는 순간 관리자 세션
// 컨텍스트에서 스크립트가 실행되는 저장형 XSS 가 된다.
// 서브미션의 videoUrl 검증(api/submissions/[id].js PUT)과 같은 패턴.
function isHttpUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) { return false; }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.upload)) return;

  // ── POST: Create pull-letter ──
  if (req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;

    // Premium gate (server-side, can't be bypassed from client).
    // 2026-07-20 — plan 뿐 아니라 subscription_status='active'도 함께 검사한다.
    // 기존엔 plan만 봐서 past_due(미납)·해지·suspended 상태의 premium 회원이
    // 게이트를 통과하던 과다부여가 있었다. (공용 헬퍼 hasActivePremium 로 통일)
    // 2026-08-03 — 체험 여부는 게이트 통과 뒤에도 계속 필요해서 바깥 스코프에 둔다.
    let trialInfo = null;
    try {
      const { data: prof, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('subscription_plan, subscription_status')
        .eq('id', user.id)
        .single();
      if (profErr || !hasActivePremium(prof)) {
        return res.status(403).json({ message: 'Premium subscription required' });
      }
    } catch (e) {
      return res.status(403).json({ message: 'Premium subscription required' });
    }
    // 체험 중인지 판정 (조회 실패해도 접수 자체는 막지 않는다 — null 이면 평소대로).
    try { trialInfo = await trialInfoForUser(supabaseAdmin, user.id); } catch (_) { trialInfo = null; }

    // ── 월 1건 상한 ──────────────────────────────────────────────
    // 한국 달력 기준 '이번 달'에 이미 접수한 건이 있으면 거절한다.
    // 거절(rejected)된 건은 횟수로 세지 않는다 — 회원 잘못이 아닐 수 있어서.
    try {
      const since = new Date(Date.now() - 62 * 86400000).toISOString();
      const { data: recent } = await supabaseAdmin
        .from('pullletters')
        .select('id, status, created_at')
        .eq('user_id', user.id)
        .gte('created_at', since);
      const thisMonth = String(kstDateStr(new Date().toISOString()) || '').slice(0, 7);
      const used = (recent || []).filter((r) => {
        if (String(r.status || '').toLowerCase() === 'rejected') return false;
        return String(kstDateStr(r.created_at) || '').slice(0, 7) === thisMonth;
      }).length;
      if (thisMonth && used >= PULLLETTER_MONTHLY_LIMIT) {
        const [y, m] = thisMonth.split('-').map(Number);
        const nextY = m === 12 ? y + 1 : y;
        const nextM = m === 12 ? 1 : m + 1;
        return res.status(429).json({
          message: `풀레터 요청은 한 달에 ${PULLLETTER_MONTHLY_LIMIT}건까지 신청할 수 있어요. `
            + `${nextY}년 ${nextM}월 1일부터 다시 신청할 수 있습니다.`,
          code: 'monthly_limit_reached',
          limit: PULLLETTER_MONTHLY_LIMIT,
          used,
          resetOn: `${nextY}-${String(nextM).padStart(2, '0')}-01`,
        });
      }
    } catch (_) { /* 상한 계산 실패 시에는 통과 — 접수를 막는 쪽이 더 위험하다 */ }

    try {
      // ── 2026-07-21 — 전송 방식 2가지를 모두 받는다 ────────────────
      // (A) JSON  : 새 방식. 클라이언트가 /pullletters/upload-url 로 받은
      //             서명 URL 에 파일을 직접 올린 뒤, 경로만 보낸다.
      //             Vercel 의 4.5MB 요청 본문 한계를 우회한다.
      // (B) multipart : 옛 방식. 배포 직후 브라우저에 캐시된 구버전
      //             프론트가 아직 이 형태로 보낼 수 있어 당분간 함께 받는다.
      //             (신규 코드는 전부 A 를 쓴다)
      const ctype = String(req.headers['content-type'] || '');
      const isJson = ctype.includes('application/json');

      let data, moodboardUrls, proposalPath;

      if (isJson) {
        data = req.body || {};
        // 클라이언트가 이미 올린 파일들의 경로. 여기서는 형식만 검증한다.
        const mUrls = Array.isArray(data.moodboardUrls) ? data.moodboardUrls : [];
        const pPath = typeof data.proposalPath === 'string' ? data.proposalPath : '';
        // 2026-07-22 (도메니코 지시) — 무드보드 별도 업로드 폐지. 무드보드·촬영
        // 컨셉·팀 구성은 촬영시안 PDF 하나에 포함. moodboardUrls 는 빈 배열 허용
        // (전달되면 하위 호환으로 그대로 저장·표시).
        // 경로 위조 방지 — 반드시 이 사용자 폴더 아래여야 한다.
        const safeUid = String(user.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!pPath || pPath.indexOf(`proposals/${safeUid}/`) !== 0 || !/\.pdf$/i.test(pPath)) {
          return res.status(400).json({ message: '촬영시안 PDF is required' });
        }
        // A-1 (2026-07-26) — 무드보드 URL 도 경로 위조 방지. 예전엔 클라이언트가
        // 보낸 문자열을 그대로 file_urls 에 저장해, `javascript:` 같은 값이
        // 관리자 화면의 <a href>/<img src> 로 그대로 렌더될 수 있었다.
        // 서브미션(_userPathPrefix)과 같은 규칙 — 자기 폴더의 공개 URL 만 허용.
        const _base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
        const _moodPrefix = `${_base}/storage/v1/object/public/pullletters/${safeUid || 'anon'}/`;
        moodboardUrls = mUrls.filter(function (u) {
          return typeof u === 'string' && u.indexOf(_moodPrefix) === 0 && u.indexOf('..') === -1;
        });
        proposalPath = pPath;
      } else {
        // ── B-4 (2026-07-26 감사) — 레거시 multipart 사용량 계측 ──────────
        // 이 분기는 2026-07-21 이전 프론트가 브라우저에 캐시된 경우만 탄다.
        // 감사 문서가 "제거 전 로그로 최근 사용 여부 확인"을 조건으로 걸었고,
        // 도메니코가 '로깅 후 보류'로 결정(2026-07-26).
        // ▶ 제거 판단 기준: Vercel 로그에서 아래 태그가 1~2주간 0건이면 안전.
        //   검색어: [pullletters][LEGACY-MULTIPART]
        console.warn('[pullletters][LEGACY-MULTIPART] 구버전 프론트 요청 수신', JSON.stringify({
          userId: user.id,
          contentType: ctype.slice(0, 80),
          ua: String(req.headers['user-agent'] || '').slice(0, 160),
          referer: String(req.headers['referer'] || '').slice(0, 120),
          at: new Date().toISOString(),
        }));
        // 촬영시안 PDF 상한은 프론트(PROPOSAL_MAX_BYTES)와 같은 20MB.
        const { fields, files } = await parseForm(req, { maxFileSize: 25 * 1024 * 1024 });
        const dataRaw = Array.isArray(fields.data) ? fields.data[0] : fields.data;
        data = dataRaw ? JSON.parse(dataRaw) : {};
        req._legacyFiles = files;   // 아래 레거시 업로드 블록에서 사용
      }

      // ── Validate required team info ──
      const ph = data.photographer || {};
      const st = data.stylist || {};
      const ct = data.contact || {};
      if (!ph.name || !ph.instagram || !ph.portfolio) {
        return res.status(400).json({ message: 'Photographer name, instagram, and portfolio are required' });
      }
      if (!st.name || !st.instagram || !st.portfolio) {
        return res.status(400).json({ message: 'Stylist name, instagram, and portfolio are required' });
      }
      if (!ct.name || !ct.email) {
        return res.status(400).json({ message: 'Contact name and email are required' });
      }
      // A-1 — 포트폴리오 링크 스킴 검증. 필수 2종 + 선택(비디오그래퍼)까지.
      const vdRaw = data.videographer || {};
      const _portfolioChecks = [
        ['photographer', ph.portfolio],
        ['stylist', st.portfolio],
      ];
      if (vdRaw.portfolio) _portfolioChecks.push(['videographer', vdRaw.portfolio]);
      for (const [role, url] of _portfolioChecks) {
        if (!isHttpUrl(url)) {
          return res.status(400).json({
            message: `Portfolio URL for ${role} must start with http:// or https://`,
            code: 'invalid_portfolio_url',
          });
        }
      }

      // Build structured team_info (videographer is optional — included only if any field is set)
      const team = {
        photographer: { name: ph.name, instagram: ph.instagram, portfolio: ph.portfolio },
        stylist:      { name: st.name, instagram: st.instagram, portfolio: st.portfolio },
        contact:      { name: ct.name, email: ct.email },
      };
      const vd = data.videographer || {};
      if (vd.name || vd.instagram || vd.portfolio) {
        team.videographer = {
          name: vd.name || '', instagram: vd.instagram || '', portfolio: vd.portfolio || '',
        };
      }
      if (Array.isArray(data.extras) && data.extras.length > 0) {
        team.extras = data.extras;
      }

      // ── 레거시(multipart) 경로에서만 서버가 파일을 받아 올린다 ──
      // JSON 경로는 클라이언트가 이미 스토리지에 직접 올렸으므로 건너뛴다.
      if (!isJson) {
        const files = req._legacyFiles || {};
        const moodboardFiles = files.moodboard
          ? (Array.isArray(files.moodboard) ? files.moodboard : [files.moodboard])
          : [];
        // 2026-07-22 — 무드보드는 더 이상 필수가 아니다 (시안 PDF 에 포함).

        const proposalRaw = files.proposal_pdf || files.proposalPdf;
        const proposalFile = Array.isArray(proposalRaw) ? proposalRaw[0] : proposalRaw;
        if (!proposalFile) {
          return res.status(400).json({ message: '촬영시안 PDF is required (field "proposal_pdf")' });
        }
        if (proposalFile.mimetype && proposalFile.mimetype !== 'application/pdf') {
          return res.status(415).json({ message: 'Proposal must be application/pdf' });
        }

        // Upload moodboard images to pullletters bucket
        moodboardUrls = await uploadFiles('pullletters', moodboardFiles, user.id);

        // Upload proposal PDF to PRIVATE 'pull-letters' bucket (same bucket
        // admin-issued PDFs use). Members read via signed URL minted in mine.js.
        const proposalBuffer = fs.readFileSync(proposalFile.filepath);
        // A-5 (2026-07-26 감사) — 확장자·Content-Type 위장 방어.
        const _sig = verifySignature(proposalBuffer.slice(0, SNIFF_BYTES), 'application/pdf');
        if (!_sig.ok) {
          console.warn('[pullletters] proposal signature mismatch —', _sig.reason);
          return res.status(415).json({ message: 'The uploaded 촬영시안 file is not a valid PDF', code: 'not_a_pdf' });
        }
        proposalPath = `proposals/${safeId(user.id)}/${Date.now()}.pdf`;
        const { error: pdfErr } = await supabaseAdmin.storage
          .from('pull-letters')
          .upload(proposalPath, proposalBuffer, {
            contentType: 'application/pdf',
            upsert: false,
          });
        if (pdfErr) {
          // A-3 (2026-07-26 감사) — 스토리지 원문 메시지는 서버 로그에만.
          console.error('Proposal PDF upload error:', pdfErr);
          return res.status(500).json({ message: '촬영시안 PDF upload failed', code: 'proposal_upload_failed' });
        }
      }

      // ── Insert row ──
      // 프로필을 먼저 조회해 요청 행에 email을 함께 저장 (RLS의 email 매칭
      // 조건·관리자 목록 표시용) — 확인 메일에도 재사용.
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('email, name, email_language, language, country').eq('id', user.id).single();

      const { data: pullLetter, error } = await supabaseAdmin
        .from('pullletters')
        .insert({
          user_id: user.id,
          // 2026-07-22 (도메니코 제안) — 컨셉 제목. 목록 식별용. 구버전 캐시 프론트
          // 호환을 위해 서버는 누락 허용(빈 값이면 null).
          title: (typeof data.title === 'string' && data.title.trim()) ? data.title.trim().slice(0, 80) : null,
          email: (profile && profile.email) || '',
          request_text: data.requestText || data.description || '',
          file_urls: moodboardUrls,
          team_info: team,
          proposal_pdf_url: proposalPath,
          // 2026-08-03 — 무료체험(7일) 기간에 접수된 건은 자동 '보류(on_hold)'.
          // 접수는 정상적으로 받되, 실제 풀레터 발급은 첫 결제가 확인된 뒤에 한다.
          // (체험만 받고 해지하는 어뷰징 방지 — 시윤 1·2단계)
          status: (trialInfo && trialInfo.isTrial) ? 'on_hold' : 'pending',
          admin_notes: (trialInfo && trialInfo.isTrial)
            ? `[자동] 무료체험 중 접수 — 첫 결제 예정일 ${trialInfo.chargeDateKst || '미상'}(KST). 결제 확인 후 발급.`
            : null,
        })
        .select()
        .single();
      if (error) throw error;

      // Confirmation email (non-blocking)
      if (profile) {
        const _lang = resolveEmailLang(profile);
        sendEmail(profile.email, templates.pullletterReceived({ name: profile.name }, _lang)).catch(() => {});
      }

      // Premium 전용 서비스 — 운영자가 바로 검토할 수 있도록 텔레그램 즉시 알림.
      // (전송 실패해도 접수에는 영향 없음 — sendTextToTelegramSafe는 throw하지 않는다)
      sendTextToTelegramSafe(
        '📮 새 풀레터 요청 (PREMIUM)\n'
        + '회원: ' + ((profile && profile.name) || '이름 없음') + ' (' + ((profile && profile.email) || '') + ')\n'
        + '포토그래퍼: ' + team.photographer.name + ' (' + team.photographer.instagram + ')\n'
        + '스타일리스트: ' + team.stylist.name + ' (' + team.stylist.instagram + ')\n'
        + (pullLetter && pullLetter.id ? ('요청 ID: ' + pullLetter.id + '\n') : '')
        + ((trialInfo && trialInfo.isTrial)
          ? ('⚠️ 무료체험 중 접수 → 자동 보류. 첫 결제 예정일 ' + (trialInfo.chargeDateKst || '미상') + '(KST)\n')
          : '')
        + '검토·발급: https://www.pap-magazine.com/admin'
      );

      return res.status(201).json({ pullLetter });
    } catch (error) {
      console.error('Create pull-letter error:', error);
      // QA 3차(2026-07-22) 근본원인: pullletters.email UNIQUE 제약이 재신청을 전부
      // 23505 로 거부 → 원시 DB 영문 메시지가 그대로 내려가 "신청에 실패했습니다"
      // 폴백만 보였다. 제약은 마이그레이션(drop_pullletters_email_unique)으로 제거
      // (도메니코 승인: 다건 신청 허용). 아래는 이중 방어 — 혹시 다른 unique 가
      // 남거나 재도입돼도 사용자에게 원인이 보이는 안내를 내려보낸다.
      if (error && error.code === '23505') {
        return res.status(409).json({
          message: 'A pull-letter request with this account already exists. If you believe this is an error, contact contact@pap-magazine.com',
          code: 'duplicate_request',
        });
      }
      // 원시 DB/내부 메시지를 그대로 노출하지 않는다 — 서버 로그에만 남기고,
      // 사용자에겐 문의처가 포함된 일반 안내를 내려보낸다(프론트가 이 문구를 표시).
      return res.status(500).json({
        message: 'Server error while creating your pull-letter request. If this keeps happening, contact contact@pap-magazine.com',
        code: 'create_failed',
      });
    }
  }

  // ── GET: List all (admin) ──
  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    try {
      const { status } = req.query;
      // QA(2026-07-22, 관리자 목록 0건 표시) — 근본 원인:
      // `profiles!inner(...)` PostgREST 임베드는 pullletters→profiles FK 를 요구하는데
      // pullletters.user_id 의 FK 는 auth.users 를 가리켜 profiles 와의 관계가 없다.
      // → PGRST200 ("Could not find a relationship between 'pullletters' and 'profiles'")
      // → 목록 전체가 500 → 관리자 화면은 "요청이 없습니다"(0건)로 보였다.
      // 신청 저장 자체는 정상(INSERT 는 임베드와 무관) — '조회'만 죽어 있었다.
      // 관리자 서브미션 목록과 동일하게 profiles 를 별도 조회해 매핑한다.
      let query = supabaseAdmin
        .from('pullletters')
        .select('*')
        .order('created_at', { ascending: false });
      if (status) query = query.eq('status', status);
      const { data: pullLetters, error } = await query;
      if (error) throw error;

      const userIds = [...new Set((pullLetters || []).map(pl => pl.user_id).filter(Boolean))];
      let profilesById = {};
      if (userIds.length > 0) {
        const { data: profs } = await supabaseAdmin
          .from('profiles')
          .select('id, name, email, subscription_plan')
          .in('id', userIds);
        for (const p of (profs || [])) profilesById[p.id] = p;
      }

      // 2026-08-03 — 관리자 목록에 '무료체험 중 · 전환 D-N' 배지를 달기 위한 정보.
      // 회원 수만큼 쿼리하지 않도록 한 번에 조회한다(N+1 방지).
      let trialByUser = {};
      try { trialByUser = await trialInfoByUserIds(supabaseAdmin, userIds); } catch (_) { trialByUser = {}; }

      // Mint signed URLs for the two private-bucket PDFs so admin UI can
      // render direct download links without an extra round-trip.
      const SIGNED_TTL = 60 * 60; // 1 hour for admin (refreshed each list call)
      async function sign(path) {
        if (!path) return null;
        try {
          const { data } = await supabaseAdmin.storage
            .from('pull-letters')
            .createSignedUrl(path, SIGNED_TTL);
          return (data && data.signedUrl) || null;
        } catch (e) { return null; }
      }
      const enriched = await Promise.all(pullLetters.map(async pl => {
        const [proposalPdfSignedUrl, pullLetterSignedUrl] = await Promise.all([
          sign(pl.proposal_pdf_url),
          sign(pl.pull_letter_url),
        ]);
        const prof = profilesById[pl.user_id] || {};
        return {
          ...pl,
          requesterName: prof.name || null,
          requesterEmail: prof.email || pl.email || null,
          requesterPlan: prof.subscription_plan || null,
          requesterTrial: trialByUser[pl.user_id] || null,
          proposalPdfSignedUrl,
          pullLetterSignedUrl,
        };
      }));

      return res.status(200).json({ pullLetters: enriched });
    } catch (error) {
      console.error('List pull-letters error:', error);
      return res.status(500).json({ message: 'Failed to fetch pull-letters' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
