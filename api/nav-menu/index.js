/**
 * GET /api/nav-menu
 *
 * QA #320 — 햄버거 메뉴 우측 카테고리 public read.
 * pap-header.js 가 페이지 로드 시 호출해 메뉴를 동적 렌더.
 *
 * 응답:
 *   {
 *     "data": [
 *       {
 *         "id": "uuid",
 *         "label_key": "navEditorial",
 *         "label_default": "EDITORIAL",
 *         "link_url": "/#all-editorials",
 *         "style": "default",
 *         "sort_order": 30
 *       }, ...
 *     ]
 *   }
 *
 * 정렬: sort_order ASC (낮을수록 앞).
 * Edge cache: s-maxage=60 + SWR 300. 관리자 편집 시 최대 1분 반영.
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
      .from('nav_menu_items')
      .select('id,label_key,label_default,link_url,style,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[nav-menu GET] supabase error', error);
      return res.status(500).json({ message: 'Failed to load nav menu' });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ data: data || [] });
  } catch (err) {
    console.error('[nav-menu GET] uncaught', err);
    return res.status(500).json({ message: 'Failed to load nav menu' });
  }
};
