/**
 * GET /api/submissions/:id — Get a single submission by ID
 *
 * Authorization: the caller must either own the submission, or be an
 * admin (role checked against `profiles.role`, NOT against the JWT, since the
 * JWT may have been issued before the role was promoted).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

// Build the same `{SUPABASE_URL}/storage/v1/object/public/submissions/{user.id}/`
// prefix the POST endpoint enforces — caller can only attach URLs in their
// own folder.
function _userPathPrefix(userId) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const safeId = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon';
  return `${base}/storage/v1/object/public/submissions/${safeId}/`;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET retrieves a single submission; PUT lets the OWNER resubmit a revised
  // version (used after admin marks status='revision'). All other methods 405.
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ message: 'Missing submission id' });
    }

    const { data: submission, error } = await supabaseAdmin
      .from('submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // ── PUT: Owner resubmits a revised version ─────────────────────────────
    if (req.method === 'PUT') {
      if (submission.user_id !== user.id) {
        return res.status(403).json({ message: 'Only the submitter can update this submission' });
      }
      // Only allow updating when the work is currently awaiting the submitter:
      // pending (not yet reviewed) or revision (admin asked for changes).
      if (submission.status !== 'pending' && submission.status !== 'revision') {
        return res.status(409).json({
          message: 'This submission can no longer be edited (status: ' + submission.status + ')',
        });
      }

      let body = req.body;
      if (!body || typeof body === 'string') {
        try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
      }
      const data = body.data || {};

      if (!data.title || !String(data.title).trim()) {
        return res.status(400).json({ message: 'Title is required' });
      }
      if (!data.genre || !Array.isArray(data.genre) || data.genre.length === 0) {
        return res.status(400).json({ message: 'At least one genre is required' });
      }

      // Sanitize URL lists — both kept-from-original and newly uploaded must
      // live in the caller's own Supabase folder.
      const prefix = _userPathPrefix(user.id);
      function _sanitize(list) {
        if (!Array.isArray(list)) return [];
        const out = [];
        for (const u of list) {
          if (typeof u === 'string' && u.startsWith(prefix) && u.indexOf('..') === -1) out.push(u);
        }
        return out;
      }
      const lookUrls = _sanitize(body.lookUrls);
      const additionalUrls = _sanitize(body.additionalUrls);
      if (lookUrls.length + additionalUrls.length === 0) {
        return res.status(400).json({ message: 'No valid image URLs provided' });
      }

      // Optional video URL
      let videoUrl = typeof data.videoUrl === 'string' ? data.videoUrl.trim() : '';
      if (videoUrl) {
        try {
          const u = new URL(videoUrl);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') videoUrl = '';
        } catch (_) { videoUrl = ''; }
      }

      const photographerCredit = Array.isArray(data.credits?.photographer)
        ? data.credits.photographer.join(', ')
        : (data.credits?.photographer || '');
      const looks = Array.isArray(data.looks) ? data.looks : [];
      const lookImageMap = Array.isArray(data.lookImageMap) ? data.lookImageMap : [];

      // Append a "[Resubmitted on …]" line to admin_notes so the editor can
      // see the history of the original feedback + what got revised.
      const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const prevNotes = submission.admin_notes ? String(submission.admin_notes).trim() : '';
      const revisionMarker = '[Resubmitted ' + ts + ' UTC by submitter]';
      const newNotes = prevNotes ? prevNotes + '\n\n' + revisionMarker : revisionMarker;

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('submissions')
        .update({
          title: data.title || 'Untitled',
          description: JSON.stringify({
            genre: data.genre || [],
            artistStatement: data.artistStatement || '',
            credits: data.credits || {},
            models: data.models || [],
            coverImageIndex: data.coverImageIndex || 0,
            contactEmail: data.contactEmail || '',
            contactName: data.contactName || '',
            photographerCredit,
            videoUrl,
            looks,
            lookImageMap,
          }),
          file_urls: [...lookUrls, ...additionalUrls],
          status: 'pending',           // back into the editorial queue
          admin_notes: newNotes,        // preserve history
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        console.error('Resubmit update failed:', updateErr);
        return res.status(500).json({ message: 'Failed to resubmit', detail: updateErr.message });
      }

      return res.status(200).json({ submission: updated });
    }

    // ── GET: Read submission (owner OR admin) ──────────────────────────────
    // Owner can always view their own. For non-owners, check admin role
    // against the database (JWT's role may be stale).
    const isOwner = submission.user_id === user.id;
    let isAdmin = false;
    if (!isOwner) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      isAdmin = !!(prof && prof.role === 'admin');
    }
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Enrich with submitter profile + active subscription plan so the admin
    // review modal has every field it needs in one round trip. Mirrors the
    // shape returned by the list endpoint.
    let submitterName = null;
    let submitterEmail = null;
    let submitterPlan = null;
    if (submission.user_id) {
      const [profRes, subRes] = await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('display_name, email')
          .eq('id', submission.user_id)
          .single(),
        supabaseAdmin
          .from('subscriptions')
          .select('plan, status')
          .eq('user_id', submission.user_id),
      ]);
      if (profRes && profRes.data) {
        submitterName = profRes.data.display_name || null;
        submitterEmail = profRes.data.email || null;
      }
      if (subRes && Array.isArray(subRes.data) && subRes.data.length > 0) {
        const active = subRes.data.find(s => s.status === 'active');
        submitterPlan = (active || subRes.data[0]).plan || null;
      }
    }

    return res.status(200).json({
      submission: {
        ...submission,
        submitterName,
        submitterEmail,
        submitterPlan,
      },
    });
  } catch (error) {
    try {
      console.error('Get submission error:', {
        name: error && error.name,
        message: error && error.message,
        code: error && error.code,
        details: error && error.details,
        hint: error && error.hint,
      });
    } catch (_) { console.error('Get submission error (raw):', error); }

    const parts = [];
    if (error && error.message) parts.push(String(error.message));
    if (error && error.code) parts.push('code=' + error.code);
    const hint = parts.join(' | ').slice(0, 300);
    return res.status(500).json({
      message: 'Failed to fetch submission' + (hint ? ` — ${hint}` : ''),
    });
  }
};
