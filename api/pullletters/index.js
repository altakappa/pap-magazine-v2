/**
 * POST /api/pullletters
 *   Two flows, both write to the same `pullletters` table:
 *
 *   (A) Legacy/standalone flow — multipart form-data
 *       From frontend/pullletter.html. Uploads moodboard images inline.
 *       Body: multipart with a JSON `data` field + `moodboard` file(s).
 *
 *   (B) Community-tied flow — JSON body
 *       From community.html (moodboard detail "풀레터 요청" button).
 *       Body: { moodBoardId, shootPurpose, shootLocationTarget?,
 *               itemsNeeded?, shootDatePlanned?, contactPhone? }
 *       No file upload — the moodboard already has the curated images.
 *
 *   Routing: content-type 'application/json' → flow B; everything else → A.
 *   To allow JSON parsing while still supporting multipart, we set
 *   bodyParser: false and parse JSON ourselves when needed.
 *
 * GET /api/pullletters
 *   Admin-only list. Optional ?status= filter. Returns moodboard title
 *   for community-flow requests.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { parseForm, uploadFiles } = require('../_lib/upload');
const { sendEmail, templates } = require('../_lib/email');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports.config = { api: { bodyParser: false } };

// Read raw request body when bodyParser is disabled (we need this for the
// JSON-mode community flow).
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

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

    // ── Flow B: community moodboard-tied request (JSON body) ──
    const ctype = (req.headers['content-type'] || '').toLowerCase();
    if (ctype.includes('application/json')) {
      try {
        const body = await readJsonBody(req);
        const {
          moodBoardId, shootPurpose, shootLocationTarget,
          itemsNeeded, shootDatePlanned, contactPhone,
        } = body || {};
        if (!moodBoardId || !shootPurpose) {
          return res.status(400).json({ message: 'moodBoardId and shootPurpose are required' });
        }
        // Verify ownership of the moodboard
        const { data: mb } = await supabaseAdmin
          .from('community_mood_boards')
          .select('id, user_id, title')
          .eq('id', moodBoardId)
          .maybeSingle();
        if (!mb) return res.status(404).json({ message: 'Moodboard not found' });
        if (mb.user_id !== user.id) {
          return res.status(403).json({ message: 'You can only request pull-letters for your own moodboards' });
        }

        const { data: pullLetter, error } = await supabaseAdmin
          .from('pullletters')
          .insert({
            user_id: user.id,
            mood_board_id: moodBoardId,
            shoot_purpose: shootPurpose,
            shoot_location_target: shootLocationTarget || null,
            items_needed: itemsNeeded || null,
            shoot_date_planned: shootDatePlanned || null,
            contact_phone: contactPhone || null,
            // Legacy column kept for compatibility with admin list rendering
            request_text: shootPurpose,
            file_urls: [],
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
        console.error('Create pull-letter (community flow) error:', error);
        return res.status(500).json({ message: error.message || 'Failed to create pull-letter request' });
      }
    }

    // ── Flow A: legacy multipart upload (frontend/pullletter.html) ──
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
        .select('*, profiles!inner(name, email, subscription_plan), mood_board:community_mood_boards!mood_board_id(id, title)')
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
          moodBoardTitle: pl.mood_board?.title || null,
          moodBoardId: pl.mood_board?.id || null,
        })),
      });
    } catch (error) {
      console.error('List pull-letters error:', error);
      return res.status(500).json({ message: 'Failed to fetch pull-letters' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
