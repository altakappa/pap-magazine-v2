/**
 * POST /api/users/preferences
 *
 * Bumps the caller's per-tag weight by +1 for each tag on the supplied
 * editorial. Anonymous callers are silently no-op'd (204) — the endpoint
 * exists for the home page personalisation, which is logged-in only.
 *
 * Body: { editorial_id: "<uuid>" }
 *
 * The endpoint reads the editorial's tags from the DB rather than trusting
 * the client — that's the security boundary, otherwise a caller could pump
 * arbitrary tag weights into their own profile.
 *
 * Idempotent in spirit but NOT in DB effect: every call legitimately bumps
 * weight, so the same user opening the same editorial twice = +2 (matches
 * the user's read pattern). Dedup by client localStorage if you don't want
 * that — server doesn't try to second-guess.
 *
 * Rate-limited per IP via the standard `api` preset; auth check happens
 * before the DB lookup so anonymous-shaped traffic is cheap.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { verifyToken } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // Anonymous callers — silently no-op. The home page tracks both anonymous
  // and logged-in opens; making the unauthenticated path 401 would force the
  // frontend to gate the call on auth state and would clutter the network tab.
  const user = verifyToken(req);
  if (!user || !user.id) {
    return res.status(204).end();
  }

  const editorialId = req.body && typeof req.body.editorial_id === 'string'
    ? req.body.editorial_id
    : null;
  if (!editorialId) {
    return res.status(400).json({ message: 'Missing editorial_id' });
  }

  try {
    // Pull tags from the DB so the caller can't inflate arbitrary weights.
    const { data: ed, error: edErr } = await supabaseAdmin
      .from('editorials')
      .select('tags')
      .eq('id', editorialId)
      .single();

    if (edErr || !ed) {
      // Unknown id is the most likely path; treat as 400 to keep error logs clean.
      return res.status(400).json({ message: 'Unknown editorial_id' });
    }

    const tags = Array.isArray(ed.tags) ? ed.tags.filter(Boolean) : [];
    if (tags.length === 0) {
      // Nothing to record — editorial has no tags. Still 204 so the frontend
      // doesn't treat it as an error.
      return res.status(204).end();
    }

    // UPSERT one row per tag. Supabase's `.upsert` with an `onConflict` clause
    // does the INSERT...ON CONFLICT DO UPDATE we want, but we need
    // `weight = weight + 1` semantics which the basic upsert can't express.
    // Using a small RPC would be cleaner; for now do it as a fetch-then-write
    // — the row count is tiny (≤ ~10 tags per editorial) so a couple of
    // round-trips is fine.
    //
    // 1) Read current weights for this user×tags slice.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('user_preferences')
      .select('tag,weight')
      .eq('user_id', user.id)
      .in('tag', tags);

    if (readErr) {
      console.error('[user-preferences] read failed', readErr);
      return res.status(500).json({ message: 'Preference update failed' });
    }

    const existingByTag = {};
    (existing || []).forEach(function (row) { existingByTag[row.tag] = row.weight; });

    const rows = tags.map(function (t) {
      return {
        user_id: user.id,
        tag: t,
        weight: (existingByTag[t] || 0) + 1,
        updated_at: new Date().toISOString(),
      };
    });

    // 2) UPSERT all rows. Composite PK (user_id, tag) handles the conflict.
    const { error: writeErr } = await supabaseAdmin
      .from('user_preferences')
      .upsert(rows, { onConflict: 'user_id,tag' });

    if (writeErr) {
      console.error('[user-preferences] upsert failed', writeErr);
      return res.status(500).json({ message: 'Preference update failed' });
    }

    res.status(204).end();
  } catch (err) {
    console.error('[user-preferences] uncaught', err);
    res.status(500).json({ message: 'Preference update failed' });
  }
};
