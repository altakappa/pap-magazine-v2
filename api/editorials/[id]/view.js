/**
 * POST /api/editorials/:id/view
 *
 * Records a single open of the editorial detail. Anonymous-friendly (no auth):
 * the table only stores editorial_id + timestamp, so there's nothing PII to
 * tie back to the visitor.
 *
 * Frontend calls this fire-and-forget when an editorial detail opens; the
 * 204 response means the caller can ignore the body entirely.
 *
 * Rate-limited per IP via the existing `api` preset (60/min). View inflation
 * by a single visitor is naturally capped — no honest user opens 60+ editorials
 * a minute, and abuse from one IP is blocked at that ceiling. Distributed
 * inflation (botnet) is out of scope for this iteration.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const id = req.query.id;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Missing editorial id' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('editorial_views')
      .insert({ editorial_id: id });

    if (error) {
      // FK violation on a non-existent editorial id is the most common path
      // here (e.g. someone hitting the URL with a bogus id). Treat as 400 to
      // keep server-side logs clean.
      if (error.code === '23503') {
        return res.status(400).json({ message: 'Unknown editorial id' });
      }
      console.error('[editorial-view] insert failed', error);
      return res.status(500).json({ message: 'View record failed' });
    }

    // 204 — nothing for the fire-and-forget caller to process.
    res.status(204).end();
  } catch (err) {
    console.error('[editorial-view] uncaught', err);
    res.status(500).json({ message: 'View record failed' });
  }
};
