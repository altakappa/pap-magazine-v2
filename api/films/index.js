/**
 * PAP Magazine - Films API
 * GET  /api/films         → 필름 목록 조회 (공개)
 * POST /api/films         → 필름 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // GET: 필름 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, category, page = 1, limit = 50 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabaseAdmin
        .from('films')
        .select('*', { count: 'exact' })
        .eq('status', status || 'published')
        .order('published_date', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (category) {
        query = query.ilike('categories', `%${category}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

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
      console.error('Films GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch films' });
    }
  }

  // POST: 필름 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { title, youtube_id, thumbnail_url, published_date, categories, tags, credits, status } = req.body;

      if (!title || !youtube_id) {
        return res.status(400).json({ error: 'title and youtube_id are required' });
      }

      const { data, error } = await supabaseAdmin
        .from('films')
        .insert({
          title,
          youtube_id,
          thumbnail_url: thumbnail_url || null,
          published_date: published_date || null,
          categories: categories || 'Film',
          tags: tags || title,
          credits: credits || [],
          status: status || 'published'
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Films POST error:', err);
      return res.status(500).json({ error: 'Failed to create film' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
