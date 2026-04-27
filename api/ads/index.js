/**
 * GET /api/ads — Public list of active interstitial ads.
 *
 * Returned in the shape pap-app.js expects:
 *   { ads: [{ type, src, poster, link, brand, duration }] }
 *
 * Used by the homepage, submission, subscribe, etc. to populate the
 * `_brandAds` array. Free-tier members see these; Standard+ skip them.
 *
 * Cached for 60s at the edge to avoid hammering Supabase on every page load.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('interstitial_ads')
      .select('id, type, src, poster, link, brand, duration, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[ads] list error:', error);
      // Fail soft — empty list means no interstitial appears (good fallback).
      return res.status(200).json({ ads: [] });
    }

    const ads = (data || []).map(a => ({
      type: a.type || 'image',
      src: a.src,
      poster: a.poster || '',
      link: a.link || '',
      brand: a.brand || '',
      duration: a.duration || 3,
    }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ads });
  } catch (err) {
    console.error('[ads] unexpected error:', err);
    return res.status(200).json({ ads: [] });
  }
};
