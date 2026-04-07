/**
 * PAP Magazine - Editorials API
 * GET  /api/editorials      → 에디토리얼 목록 조회 (공개)
 * POST /api/editorials      → 에디토리얼 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // GET: 에디토리얼 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, page = 1, limit = 25 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const { data, error, count } = await supabaseAdmin
        .from('editorials')
        .select('*', { count: 'exact' })
        .eq('status', status || 'published')
        .order('published_date', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

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
      console.error('Editorials GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch editorials' });
    }
  }

  // POST: 에디토리얼 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { title, slug, cover_image, published_date, url, tags, issue, thumbnail, gallery, credits, fashion, status } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const { data, error } = await supabaseAdmin
        .from('editorials')
        .insert({
          title,
          slug: slug || null,
          cover_image: cover_image || null,
          published_date: published_date || null,
          url: url || null,
          tags: tags || [],
          issue: issue || null,
          thumbnail: thumbnail || null,
          gallery: gallery || [],
          credits: credits || {},
          fashion: fashion || {},
          status: status || 'published'
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Editorials POST error:', err);
      return res.status(500).json({ error: 'Failed to create editorial' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
