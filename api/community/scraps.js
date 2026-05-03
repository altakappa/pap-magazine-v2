/**
 * GET    /api/community/scraps?userId=...&page=1   — List a user's scrapbook (defaults to caller)
 * POST   /api/community/scraps                     — Add a scrap
 *   body: { imageUrl, sourceUrl?, sourceType?, sourceId?, note? }
 * DELETE /api/community/scraps?id=...              — Remove own scrap
 *
 * Scrapbook is a personal visual collection (web-native curation).
 * Public-readable, owner-mutable.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, verifyToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const ALLOWED_SOURCE_TYPES = new Set([
  'editorial', 'film', 'article', 'moodboard', 'external', 'upload',
]);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // ── GET: list scraps (public; userId optional, defaults to caller) ──
  if (req.method === 'GET') {
    try {
      const caller = verifyToken(req);
      const { userId, page = 1 } = req.query;
      const targetUserId = userId || (caller && caller.id);
      if (!targetUserId) {
        return res.status(400).json({ message: 'userId required' });
      }
      const perPage = 40;
      const offset = (parseInt(page, 10) - 1) * perPage;

      const { data, count, error } = await supabaseAdmin
        .from('community_scraps')
        .select('*', { count: 'exact' })
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .range(offset, offset + perPage - 1);

      if (error) throw error;

      return res.status(200).json({
        scraps: (data || []).map(s => ({
          id: s.id,
          imageUrl: s.image_url,
          sourceUrl: s.source_url,
          sourceType: s.source_type,
          sourceId: s.source_id,
          note: s.note,
          createdAt: s.created_at,
        })),
        total: count || 0,
        page: parseInt(page, 10),
        totalPages: Math.ceil((count || 0) / perPage),
      });
    } catch (error) {
      console.error('List scraps error:', error);
      return res.status(500).json({ message: 'Failed to list scraps' });
    }
  }

  const user = requireAuth(req, res);
  if (!user) return;

  // ── POST: add scrap ──
  if (req.method === 'POST') {
    try {
      const { imageUrl, sourceUrl, sourceType, sourceId, note } = req.body || {};
      if (!imageUrl || typeof imageUrl !== 'string') {
        return res.status(400).json({ message: 'imageUrl required' });
      }
      const cleanType = sourceType && ALLOWED_SOURCE_TYPES.has(sourceType) ? sourceType : 'external';

      const { data, error } = await supabaseAdmin
        .from('community_scraps')
        .insert({
          user_id: user.id,
          image_url: imageUrl,
          source_url: sourceUrl || null,
          source_type: cleanType,
          source_id: sourceId || null,
          note: note || null,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ scrap: data });
    } catch (error) {
      console.error('Create scrap error:', error);
      return res.status(500).json({ message: 'Failed to add scrap' });
    }
  }

  // ── DELETE: remove own scrap ──
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ message: 'id required' });
      const { error } = await supabaseAdmin
        .from('community_scraps')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
      return res.status(200).json({ deleted: true });
    } catch (error) {
      console.error('Delete scrap error:', error);
      return res.status(500).json({ message: 'Failed to delete scrap' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
