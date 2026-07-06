/**
 * GET /api/pepperit-articles — 페퍼릿 기사 공개 목록 (랜딩 그리드용)
 *   ?limit=12&page=1&category=NEWS
 */

const { supabaseAdmin } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  try {
    const limit = Math.min(50, Math.max(1, parseInt((req.query && req.query.limit) || '12', 10) || 12));
    const page = Math.max(1, parseInt((req.query && req.query.page) || '1', 10) || 1);
    const category = req.query && req.query.category;

    let q = supabaseAdmin.from('pepperit_articles')
      .select('id, title, slug, category, thumbnail_url, published_date, tags', { count: 'exact' })
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (category) q = q.eq('category', String(category).toUpperCase());

    const { data, count, error } = await q;
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      data: data || [],
      pagination: { page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit) },
    });
  } catch (err) {
    console.error('[pepperit-articles] error:', err);
    return res.status(500).json({ error: 'list failed' });
  }
};
