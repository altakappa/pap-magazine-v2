/**
 * POST /api/pullletters       — Create pull-letter request (user, multipart)
 * GET  /api/pullletters        — List all pull-letters (admin, ?status=)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { parseForm, uploadFiles } = require('../_lib/upload');
const { sendEmail, templates } = require('../_lib/email');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (rateLimit(req, res, RATE_LIMITS.upload)) return;

  // ── POST: Create pull-letter ──
  if (req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;

    // Pull-letter submissions are premium-only (enforced server-side so
    // frontend gate bypasses via dev tools can't sneak through).
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
      const { fields, files } = await parseForm(req);
      const data = JSON.parse(
        Array.isArray(fields.data) ? fields.data[0] : fields.data
      );

      // Upload moodboard files
      const moodboardFiles = files.moodboard
        ? (Array.isArray(files.moodboard) ? files.moodboard : [files.moodboard])
        : [];
      const fileUrls = await uploadFiles('pullletters', moodboardFiles, user.id);

      const { data: pullLetter, error } = await supabaseAdmin
        .from('pullletters')
        .insert({
          user_id: user.id,
          request_text: data.requestText || data.description || '',
          file_urls: fileUrls,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      // Send confirmation email (non-blocking)
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('email, name').eq('id', user.id).single();
      if (profile) {
        sendEmail(profile.email, templates.pullletterReceived({ name: profile.name })).catch(() => {});
      }

      return res.status(201).json({ pullLetter });
    } catch (error) {
      console.error('Create pull-letter error:', error);
      return res.status(500).json({ message: 'Failed to create pull-letter request' });
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

      if (status) {
        query = query.eq('status', status);
      }

      const { data: pullLetters, error } = await query;

      if (error) throw error;

      return res.status(200).json({
        pullLetters: pullLetters.map(pl => ({
          ...pl,
          requesterName: pl.profiles?.name,
          requesterEmail: pl.profiles?.email,
          requesterPlan: pl.profiles?.subscription_plan,
        })),
      });
    } catch (error) {
      console.error('List pull-letters error:', error);
      return res.status(500).json({ message: 'Failed to fetch pull-letters' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
