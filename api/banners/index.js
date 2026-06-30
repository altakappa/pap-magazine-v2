/**
 * GET /api/banners
 *
 * QA #295 — 메인 hero 배너 public read. 활성화된 모든 cover_groups 와
 * 그 안의 이미지 목록을 sort_order 대로 반환. frontend hero
 * (pap-shell-bootstrap.js) 가 호출.
 *
 * 응답:
 *   {
 *     "data": [
 *       {
 *         "id": "uuid", "issue": "JULY ISSUE", "title": "Masquerade",
 *         "link_url": "/editorial/masquerade", "sort_order": 0,
 *         "images": [
 *           { "id": "uuid", "image_url": "...", "sort_order": 0 },
 *           ...
 *         ]
 *       }
 *     ]
 *   }
 *
 * Edge cache: s-maxage=300 (5분) + SWR 1h. admin 저장 시 frontend 에서
 * fetch 시 cache-buster 파라미터를 붙여 즉시 갱신.
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
    // 그룹 + 이미지 nested. PostgREST 의 embed 문법으로 단일 round-trip.
    const { data: groups, error } = await supabaseAdmin
      .from('cover_groups')
      .select('id,issue,title,link_url,sort_order,images:cover_images(id,image_url,sort_order)')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[banners GET] supabase error', error);
      return res.status(500).json({ message: 'Failed to load banners' });
    }

    // 그룹 내부 이미지도 sort_order 정렬 (embed 는 서버측 정렬 없음).
    const out = (groups || []).map(function (g) {
      const imgs = Array.isArray(g.images) ? g.images.slice() : [];
      imgs.sort(function (a, b) {
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
      return Object.assign({}, g, { images: imgs });
    });

    // QA #294 cache 패턴과 동일 ─ 5분 edge + 1시간 SWR.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ data: out });
  } catch (err) {
    console.error('[banners GET] uncaught', err);
    return res.status(500).json({ message: 'Failed to load banners' });
  }
};
