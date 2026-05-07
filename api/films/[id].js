/**
 * PAP Magazine - Film Detail API
 * GET    /api/films/:id   → 필름 상세 조회 (공개)
 * PUT    /api/films/:id   → 필름 수정 (관리자)
 * DELETE /api/films/:id   → 필름 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('films')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Film not found' });
      }

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Film GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch film' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      const allowed = [
        'title', 'youtube_id', 'thumbnail_url', 'published_date',
        'categories', 'tags', 'credits', 'slug', 'status',
        'related_editorial_id',
      ];
      // Coerce TEXT[] columns to arrays so admin payloads from older
      // form versions (string-shape) don't break the schema.
      const toArrayCols = new Set(['categories', 'tags']);
      for (const key of allowed) {
        if (req.body[key] === undefined) continue;
        let v = req.body[key];
        if (toArrayCols.has(key)) {
          v = Array.isArray(v) ? v : (v == null || v === '' ? [] : [String(v)]);
        }
        updates[key] = v;
      }

      const { data, error } = await supabaseAdmin
        .from('films')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Film PUT error:', err);
      return res.status(500).json({ error: 'Failed to update film' });
    }
  }

  // DELETE: 삭제
  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { error } = await supabaseAdmin
        .from('films')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ message: 'Film deleted' });
    } catch (err) {
      console.error('Film DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete film' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
