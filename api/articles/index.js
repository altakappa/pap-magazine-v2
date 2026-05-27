/**
 * PAP Magazine - Articles API
 * GET  /api/articles      → 아티클 목록 조회 (공개)
 * POST /api/articles      → 아티클 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET: 아티클 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, category, page = 1, limit: rawLimit = 25 } = req.query;
      const limit = Math.min(Math.max(1, parseInt(rawLimit) || 25), 100);
      const offset = (parseInt(page) - 1) * limit;

      // QA #186 — list-view projection drops `content` (the long article
      // body) + `gallery` + `credits`. Article cards only need
      // title/subtitle/thumbnail/category/published_date for rendering.
      const LIST_COLUMNS = [
        'id','title','subtitle','slug','thumbnail_url','hero_image_url',
        'category','tags','published_date','custom_url','status'
      ].join(',');
      const requestedStatus = status || 'published';
      let query = supabaseAdmin
        .from('articles')
        .select(LIST_COLUMNS, { count: 'exact' })
        .eq('status', requestedStatus)
        .order('published_date', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      // QA #186 — edge cache the published list.
      if (requestedStatus === 'published') {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      } else {
        res.setHeader('Cache-Control', 'private, no-store');
      }

      return res.status(200).json({
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / parseInt(limit))
        }
      });
    } catch (err) {
      console.error('Articles GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch articles' });
    }
  }

  // POST: 아티클 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { title, subtitle, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const { data, error } = await supabaseAdmin
        .from('articles')
        .insert({
          title,
          subtitle: subtitle || null,
          published_date: published_date || null,
          category: category || null,
          tags: tags || [],
          thumbnail_url: thumbnail_url || null,
          hero_image_url: hero_image_url || null,
          content: content || '',
          gallery: gallery || [],
          credits: credits || [],
          custom_url: custom_url || null,
          status: status || 'published'
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Articles POST error:', err);
      return res.status(500).json({ error: 'Failed to create article' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
