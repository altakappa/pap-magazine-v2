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
 *     moodboard:    image file(s)  — REQUIRED (≥1)  — uploaded to `pullletters` bucket
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

module.exports.config = { api: { bodyParser: false } };

// Sanitize role-like strings for storage paths
function safeId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon';
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
        if (mUrls.length === 0) {
          return res.status(400).json({ message: 'At least one moodboard image is required' });
        }
        // 경로 위조 방지 — 반드시 이 사용자 폴더 아래여야 한다.
        const safeUid = String(user.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!pPath || pPath.indexOf(`proposals/${safeUid}/`) !== 0 || !/\.pdf$/i.test(pPath)) {
          return res.status(400).json({ message: '촬영시안 PDF is required' });
        }
        moodboardUrls = mUrls;
        proposalPath = pPath;
      } else {
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
        if (moodboardFiles.length === 0) {
          return res.status(400).json({ message: 'At least one moodboard image is required' });
        }

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
        proposalPath = `proposals/${safeId(user.id)}/${Date.now()}.pdf`;
        const { error: pdfErr } = await supabaseAdmin.storage
          .from('pull-letters')
          .upload(proposalPath, proposalBuffer, {
            contentType: 'application/pdf',
            upsert: false,
          });
        if (pdfErr) {
          console.error('Proposal PDF upload error:', pdfErr);
          return res.status(500).json({ message: '촬영시안 PDF upload failed: ' + pdfErr.message });
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
          status: 'pending',
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
