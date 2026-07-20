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
      const { fields, files } = await parseForm(req, { maxFileSize: 50 * 1024 * 1024 });
      const dataRaw = Array.isArray(fields.data) ? fields.data[0] : fields.data;
      const data = dataRaw ? JSON.parse(dataRaw) : {};

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

      // ── Validate + upload files ──
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
      const moodboardUrls = await uploadFiles('pullletters', moodboardFiles, user.id);

      // Upload proposal PDF to PRIVATE 'pull-letters' bucket (same bucket
      // admin-issued PDFs use). Members read via signed URL minted in mine.js.
      const proposalBuffer = fs.readFileSync(proposalFile.filepath);
      const proposalPath = `proposals/${safeId(user.id)}/${Date.now()}.pdf`;
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

      // ── Insert row ──
      // 프로필을 먼저 조회해 요청 행에 email을 함께 저장 (RLS의 email 매칭
      // 조건·관리자 목록 표시용) — 확인 메일에도 재사용.
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('email, name, email_language, language, country').eq('id', user.id).single();

      const { data: pullLetter, error } = await supabaseAdmin
        .from('pullletters')
        .insert({
          user_id: user.id,
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
      return res.status(500).json({ message: error.message || 'Failed to create pull-letter request' });
    }
  }

  // ── GET: List all (admin) ──
  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    try {
      const { status } = req.query;
      let query = supabaseAdmin
        .from('pullletters')
        .select('*, profiles!inner(name, email, subscription_plan)')
        .order('created_at', { ascending: false });
      if (status) query = query.eq('status', status);
      const { data: pullLetters, error } = await query;
      if (error) throw error;

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
        return {
          ...pl,
          requesterName: pl.profiles?.name,
          requesterEmail: pl.profiles?.email,
          requesterPlan: pl.profiles?.subscription_plan,
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
