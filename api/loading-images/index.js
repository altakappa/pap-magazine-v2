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

    // QA #315 — s-maxage 를 5분 → 30초 로 단축.
    // 로딩 이미지는 저용량 (수 KB JSON) + 트래픽 낮음이라 캐시 TTL 을
    // 짧게 잡아도 origin 부담 미미. 관리자가 등록/삭제/순서 변경 후
    // 최대 30초 내에 실제 웹사이트에 반영되도록 함.
    // SWR 은 300초로 유지 (짧게 안 하면 origin 실패 시 fallback 불가).
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return res.status(200).json({ data: data || [] });
  } catch (err) {
    console.error('[loading-images GET] uncaught', err);
    return res.status(500).json({ message: 'Failed to load loading images' });
  }
};
