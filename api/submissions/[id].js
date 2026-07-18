/**
 * GET /api/submissions/:id — Get a single submission by ID
 *
 * Authorization: the caller must either own the submission, or be an
 * admin (role checked against `profiles.role`, NOT against the JWT, since the
 * JWT may have been issued before the role was promoted).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { normalizeGenres } = require('../_lib/submissionCategories');
const { classifySubmissionType } = require('../_lib/submissionType');

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

  // GET retrieves a single submission. PUT lets the OWNER resubmit a
  // revised version (after admin marks status='revision'). PATCH lets
  // an ADMIN curate the gallery during review — reorder / remove images
  // and pick the cover, without flipping any workflow state. DELETE lets
  // the OWNER hard-delete their own submission, gated on a small status
  // whitelist so an already-published editorial can't be orphaned.
  // QA #225 — added DELETE.
  if (req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // PATCH uses the admin gate; everything else stays on standard auth so
  // the submitter can still load their own submission detail and resubmit.
  let user;
  if (req.method === 'PATCH') {
    user = await requireAdmin(req, res);
  } else {
    user = requireAuth(req, res);
  }
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

    // ── DELETE: Owner hard-deletes their own submission ────────────────────
    // QA #225 — Members can clear out their own draft, awaiting-review, or
    // rejected submissions. We explicitly DO NOT allow deleting once the
    // editor has taken any positive action ('approved', 'final_approved',
    // 'uploaded', 'resubmitted') because those are linked to either an
    // editorial (source_submission_id) or to an in-flight workflow the
    // admin owns. Admins still have the admin-side reject + 30-day purge
    // path for cleanup. Storage objects under
    // submissions/<user.id>/<sub.id>/ are NOT swept here — they age out
    // with the rejected-submissions purge cron, and a stray file in the
    // user's own folder isn't a security risk.
    if (req.method === 'DELETE') {
      if (submission.user_id !== user.id) {
        return res.status(403).json({ message: 'Only the submitter can delete this submission' });
      }
      const DELETABLE_STATUSES = ['pending', 'revision', 'rejected'];
      if (DELETABLE_STATUSES.indexOf(submission.status) === -1) {
        return res.status(409).json({
          message: 'This submission can no longer be deleted (status: ' + submission.status + ')',
        });
      }
      const { error: delErr } = await supabaseAdmin
        .from('submissions')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (delErr) {
        console.error('Submission DELETE failed:', delErr);
        return res.status(500).json({ message: 'Failed to delete submission', detail: delErr.message });
      }
      return res.status(200).json({ ok: true, id });
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

      // FIX-1 (2026-07-19) — mirror the create path: normalize + whitelist the
      // category and persist the primary pick into the `category` column. Without
      // this, any submission that went through a revision round returned to
      // category=NULL on resubmit, re-opening the very gap FIX-1 closes.
      const normalizedGenres = normalizeGenres(data.genre);
      if (normalizedGenres.length === 0) {
        return res.status(400).json({ message: 'At least one valid category is required' });
      }
      const primaryCategory = normalizedGenres[0];

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
      // Recompute submission-type on resubmit so a revision that changes the
      // look count or brand mix re-classifies correctly (mirror of POST path).
      const { submissionType } = classifySubmissionType(looks, lookImageMap);

      // Append a "[Resubmitted on …]" line to admin_notes so the editor can
      // see the history of the original feedback + what got revised.
      const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const prevNotes = submission.admin_notes ? String(submission.admin_notes).trim() : '';
      const revisionMarker = '[Resubmitted ' + ts + ' UTC by submitter]';
      const newNotes = prevNotes ? prevNotes + '\n\n' + revisionMarker : revisionMarker;

      // QA #168 — persist structured team array (mirror of POST path)
      const team = Array.isArray(data.team) ? data.team : [];

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('submissions')
        .update({
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
          status: 'pending',           // back into the editorial queue
          admin_notes: newNotes,        // preserve history
          // QA #175 — stamp the moment of resubmission so the admin list
          // can render "보완 완료" instead of the generic "대기 중" and
          // surface a dedicated filter button. NULL stays for fresh
          // submissions that never went through a revision round.
          resubmitted_at: new Date().toISOString(),
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

    // ── PATCH: Admin curates the gallery during review ─────────────────────
    // Allows reordering / removing existing file_urls and picking a cover
    // image. Does NOT change submission.status or stamp resubmitted_at —
    // this is a quiet "tidy the gallery before approval" action.
    //
    // Body shape: { file_urls: [string], coverImageIndex?: number }
    //
    // Guardrails:
    //   • file_urls MUST be a subset (in any order) of the existing
    //     submission.file_urls. Admin can remove or reorder, but cannot
    //     inject new URLs.
    //   • coverImageIndex is validated against the NEW file_urls length.
    //   • Description JSON's coverImageIndex + lookImageMap are kept in
    //     sync so the rendered editorial still maps each kept image to
    //     its original look + cover pick.
    if (req.method === 'PATCH') {
      let body = req.body;
      if (!body || typeof body === 'string') {
        try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
      }
      if (!Array.isArray(body.file_urls)) {
        return res.status(400).json({ message: 'file_urls must be an array' });
      }
      const originalUrls = Array.isArray(submission.file_urls) ? submission.file_urls : [];
      const originalSet = new Set(originalUrls);
      const nextUrls = [];
      const seen = new Set();
      for (const u of body.file_urls) {
        if (typeof u !== 'string' || !u) continue;
        if (!originalSet.has(u)) {
          return res.status(400).json({ message: 'file_urls may only contain URLs from the original submission' });
        }
        if (seen.has(u)) continue; // dedupe
        seen.add(u);
        nextUrls.push(u);
      }
      if (nextUrls.length === 0) {
        return res.status(400).json({ message: 'At least one image must remain' });
      }

      let coverIdx = (typeof body.coverImageIndex === 'number')
        ? Math.max(0, Math.min(nextUrls.length - 1, body.coverImageIndex))
        : 0;

      // Rebuild description JSON so coverImageIndex + lookImageMap track
      // the new order. We drop any lookImageMap entries whose URL was
      // removed (mapped by ORIGINAL index); the surviving ones get
      // reindexed in the new order.
      let desc = {};
      try { desc = submission.description ? JSON.parse(submission.description) : {}; } catch (_) { desc = {}; }
      if (Array.isArray(desc.lookImageMap) && desc.lookImageMap.length === originalUrls.length) {
        const newLookImageMap = [];
        for (const u of nextUrls) {
          const origIdx = originalUrls.indexOf(u);
          newLookImageMap.push((origIdx >= 0 && desc.lookImageMap[origIdx]) || null);
        }
        desc.lookImageMap = newLookImageMap;
      }
      // QA #215 — also re-key fashion.imageCredits so admin-edited
      // per-image credits track the new file_urls order. Keys are
      // 1-based (img_1, img_2, …) and pointed at by index against the
      // ORIGINAL file_urls. After the curation the survivors keep their
      // credits, the deleted ones' credits are dropped (cascade), and
      // the remaining keys are tight-packed to match nextUrls order.
      if (desc.fashion && desc.fashion.imageCredits && typeof desc.fashion.imageCredits === 'object') {
        const oldCredits = desc.fashion.imageCredits;
        const newCredits = {};
        for (let newIdx = 0; newIdx < nextUrls.length; newIdx++) {
          const url = nextUrls[newIdx];
          const origIdx = originalUrls.indexOf(url);
          if (origIdx >= 0) {
            const oldKey = 'img_' + (origIdx + 1);
            if (oldCredits[oldKey]) {
              newCredits['img_' + (newIdx + 1)] = oldCredits[oldKey];
            }
          }
        }
        desc.fashion = Object.assign({}, desc.fashion, { imageCredits: newCredits });
      }
      desc.coverImageIndex = coverIdx;

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('submissions')
        .update({
          file_urls: nextUrls,
          description: JSON.stringify(desc),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        console.error('Gallery curation update failed:', updateErr);
        return res.status(500).json({ message: 'Failed to save gallery changes', detail: updateErr.message });
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
    //
    // QA #189 — also fan in the linked editorial (slug + status +
    // scheduled_publish_at + published_date) so the submitter's MY
    // SUBMISSIONS modal can render the publication-date phrase in the
    // approval block ("around the X of Month") without an extra fetch.
    let submitterName = null;
    let submitterEmail = null;
    let submitterPlan = null;
    let linkedEditorial = null;
    if (submission.user_id) {
      const [profRes, subRes, edRes] = await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('display_name, email')
          .eq('id', submission.user_id)
          .single(),
        supabaseAdmin
          .from('subscriptions')
          .select('plan, status')
          .eq('user_id', submission.user_id),
        supabaseAdmin
          .from('editorials')
          .select('id, slug, status, published_date, scheduled_publish_at')
          .eq('source_submission_id', submission.id)
          .maybeSingle(),
      ]);
      if (profRes && profRes.data) {
        submitterName = profRes.data.display_name || null;
        submitterEmail = profRes.data.email || null;
      }
      if (subRes && Array.isArray(subRes.data) && subRes.data.length > 0) {
        const active = subRes.data.find(s => s.status === 'active');
        submitterPlan = (active || subRes.data[0]).plan || null;
      }
      if (edRes && edRes.data) {
        linkedEditorial = edRes.data;
      }
    }

    return res.status(200).json({
      submission: {
        ...submission,
        submitterName,
        submitterEmail,
        submitterPlan,
        linked_editorial: linkedEditorial,
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
