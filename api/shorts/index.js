/**
 * PAP Magazine - Shorts API
 * GET  /api/shorts         → 쇼츠 목록 조회 (공개)
 * POST /api/shorts         → 쇼츠 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // GET: 쇼츠 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, page = 1, limit = 50 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabaseAdmin
        .from('shorts')
        .select('*', { count: 'exact' })
        .eq('status', status || 'published')
        .order('published_date', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

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
      console.error('Shorts GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch shorts' });
    }
  }

  // POST: 쇼츠 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { title, youtube_id, thumbnail_url, published_date, tags, status } = req.body;

      if (!title || !youtube_id) {
        return res.status(400).json({ error: 'title and youtube_id are required' });
      }

      const { data, error } = await supabaseAdmin
        .from('shorts')
        .insert({
          title,
          youtube_id,
          thumbnail_url: thumbnail_url || null,
          published_date: published_date || null,
          tags: tags || title,
          status: status || 'published'
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Shorts POST error:', err);
      return res.status(500).json({ error: 'Failed to create short' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
