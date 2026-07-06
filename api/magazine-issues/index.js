/**
 * GET /api/magazine-issues
 *
 * QA #317 — Magazine 발행호 목록 public read.
 * magazine.html 이 호출해 발행호 카드를 동적 렌더링.
 *
 * 응답:
 *   {
 *     "data": [
 *       {
 *         "id": "uuid",
 *         "issue_number": 86,
 *         "title": "March 2026",
 *         "issue_year": 2026,
 *         "issue_month": 3,
 *         "month_label": "MAR 2026",
 *         "cover_image": "...",
 *         "editorial_count": 19,
 *         "link_url": "PAP_Magazine_March_2026.html",
 *         "is_latest": true,
 *         "sort_order": 86
 *       },
 *       ...
 *     ]
 *   }
 *
 * 정렬: issue_year DESC, sort_order DESC (최신 발행이 먼저).
 * Edge cache: s-maxage=60 + SWR 300. 새 발행호 등록/수정 시 최대 1분 반영.
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
      .from('magazine_issues')
      .select('id,issue_number,title,issue_year,issue_month,month_label,cover_image,editorial_count,link_url,is_latest,sort_order')
      .eq('is_active', true)
      .order('issue_year', { ascending: false })
      .order('sort_order', { ascending: false });

    if (error) {
      console.error('[magazine-issues GET] supabase error', error);
      return res.status(500).json({ message: 'Failed to load magazine issues' });
    }

    // QA #317 — s-maxage=60 (1분), SWR=300 (5분).
    // 발행호 등록/수정 시 최대 1분 내 웹사이트 반영.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ data: data || [] });
  } catch (err) {
    console.error('[magazine-issues GET] uncaught', err);
    return res.status(500).json({ message: 'Failed to load magazine issues' });
  }
};
