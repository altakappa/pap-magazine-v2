/**
 * GET /api/editorials/trending?period=7d&limit=12
 *
 * Returns top published editorials by view count in the requested time window.
 * Powers the "인기 에디토리얼" row on index.html.
 *
 * Query params:
 *   period — "1d" | "7d" (default) | "30d" | "all"  (capped at 1 year)
 *   limit  — 1..50 (default 12, matches the home-row card slot count)
 *
 * Implementation calls the trending_editorials() PG function defined in
 * supabase_migrations/011_editorial_views.sql so the GROUP BY + window
 * stays as a single round-trip.
 *
 * Cache-Control allows brief edge caching (60s s-maxage) — trending doesn't
 * need to be real-time, and 60s of staleness saves ~99% of the DB hits on
 * a busy day.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const PERIOD_HOURS = {
  '1d': 24,
  '7d': 168,
  '30d': 720,
  'all': 24 * 365, // 1 year ceiling — anything older is "evergreen", not trending
};

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const periodKey = String(req.query.period || '7d');
  const periodHours = PERIOD_HOURS[periodKey] || PERIOD_HOURS['7d'];

  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 12;
  if (limit > 50) limit = 50;

  try {
    const { data, error } = await supabaseAdmin.rpc('trending_editorials', {
      period_hours: periodHours,
      max_items: limit,
    });

    if (error) {
      console.error('[trending] rpc failed', error);
      return res.status(500).json({ message: 'Trending lookup failed' });
    }

    // QA #294 — Disk IO 경고 대응. trending은 시간 단위 갱신으로 충분.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
    res.status(200).json({ data: data || [], period: periodKey, limit });
  } catch (err) {
    console.error('[trending] uncaught', err);
    res.status(500).json({ message: 'Trending lookup failed' });
  }
};
