/**
 * PAP Magazine - Short Detail API
 * GET    /api/shorts/:id   → 쇼츠 상세 조회 (공개)
 * PUT    /api/shorts/:id   → 쇼츠 수정 (관리자)
 * DELETE /api/shorts/:id   → 쇼츠 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('shorts')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Short not found' });
      }

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Short GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch short' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      const allowed = ['title', 'youtube_id', 'thumbnail_url', 'published_date', 'tags', 'status'];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      const { data, error } = await supabaseAdmin
        .from('shorts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Short PUT error:', err);
      return res.status(500).json({ error: 'Failed to update short' });
    }
  }

  // DELETE: 삭제
  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { error } = await supabaseAdmin
        .from('shorts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ message: 'Short deleted' });
    } catch (err) {
      console.error('Short DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete short' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
