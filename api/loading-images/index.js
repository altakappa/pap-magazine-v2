/**
 * GET /api/loading-images
 *
 * QA #310 — 스플래시 로더 이미지 pool. 활성화된 loading_images 를
 * sort_order 대로 반환. frontend 스플래시 (pap-splash-loader.js) 가 호출.
 *
 * 응답:
 *   {
 *     "data": [
 *       {
 *         "id": "uuid",
 *         "image_url_pc": "...",
 *         "image_url_mobile": "..." | null,
 *         "alt_text": "..." | null,
 *         "sort_order": 0
 *       },
 *       ...
 *     ]
 *   }
 *
 * Edge cache: s-maxage=300 (5분) + SWR 1h. banners API 와 동일한 패턴.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors }    = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  try {
    const { data, error } = await supabaseAdmin
      .from('loading_images')
      .select('id,image_url_pc,image_url_mobile,alt_text,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[loading-images GET] supabase error', error);
      return res.status(500).json({ message: 'Failed to load loading images' });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ data: data || [] });
  } catch (err) {
    console.error('[loading-images GET] uncaught', err);
    return res.status(500).json({ message: 'Failed to load loading images' });
  }
};
