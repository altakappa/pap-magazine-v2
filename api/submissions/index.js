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
          description: JSON.stringify({
            genre: data.genre || [],
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
          }),
          file_urls: [...lookUrls, ...additionalUrls],
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        console.error('Submissions insert failed:', error);
        throw error;
      }

      // No email — submitter is directed to check MY SUBMISSIONS on the
      // website within 3 business days. Keeps users engaged with the site
      // and avoids spam-folder deliverability issues.

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

      const parts = [];
      if (error && error.message) parts.push(String(error.message));
      if (error && error.code) parts.push('code=' + error.code);
      if (error && error.details) parts.push(String(error.details).slice(0, 120));
      const hint = parts.join(' | ').slice(0, 300);
      return res.status(500).json({
        message: 'Failed to create submission' + (hint ? ` — ${hint}` : ''),
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
        const { data: editorialRows } = await supabaseAdmin
          .from('editorials')
          .select('id, slug, status, published_date, source_submission_id')
          .in('source_submission_id', submissionIds);
        if (Array.isArray(editorialRows)) {
          for (const er of editorialRows) {
            if (er && er.source_submission_id) {
              linkedEditorialBySubId[er.source_submission_id] = er;
            }
          }
        }
      }

      // Hydrate submitter profile + subscription plan via side queries.
      const userIds = Array.from(new Set(
        (submissions || []).map(s => s.user_id).filter(Boolean)
      ));

      let profilesById = {};
      let plansById = {};

      if (userIds.length > 0) {
        const [profRes, subRes] = await Promise.all([
          supabaseAdmin
            .from('profiles')
            .select('id, display_name, email')
            .in('id', userIds),
          supabaseAdmin
            .from('subscriptions')
            .select('user_id, plan, status')
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
      // Echo the underlying Supabase/Postgres error so it shows up in the
      // admin UI — otherwise a generic message makes the next bug invisible.
      try {
        console.error('List submissions error:', {
          name: error && error.name,
          message: error && error.message,
          code: error && error.code,
          details: error && error.details,
          hint: error && error.hint,
        });
      } catch (_) { console.error('List submissions error (raw):', error); }

      const parts = [];
      if (error && error.message) parts.push(String(error.message));
      if (error && error.code) parts.push('code=' + error.code);
      if (error && error.details) parts.push(String(error.details).slice(0, 120));
      const hint = parts.join(' | ').slice(0, 300);
      return res.status(500).json({
        message: 'Failed to fetch submissions' + (hint ? ` — ${hint}` : ''),
      });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
