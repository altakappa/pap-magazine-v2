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
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

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

    // Premium gate (server-side, can't be bypassed from client)
    try {
      const { data: prof, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('subscription_plan')
        .eq('id', user.id)
        .single();
      if (profErr || !prof || prof.subscription_plan !== 'premium') {
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
      const { data: pullLetter, error } = await supabaseAdmin
        .from('pullletters')
        .insert({
          user_id: user.id,
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
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('email, name').eq('id', user.id).single();
      if (profile) {
        sendEmail(profile.email, templates.pullletterReceived({ name: profile.name })).catch(() => {});
      }

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
