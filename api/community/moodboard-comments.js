/**
 * Mood board comments — lightweight conversation primitive.
 *
 * GET    /api/community/moodboard-comments?boardId=...   List (public read)
 * POST   /api/community/moodboard-comments               Add: { boardId, content }
 * DELETE /api/community/moodboard-comments?id=...        Remove own comment
 *
 * Notification: when someone comments on a board, the board owner gets a
 * type='comment' notification with target_type='mood_board'. Self-comments
 * skip the notification. (handleNotifClick on the frontend already routes
 * mood_board targets to openMoodboard.)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, verifyToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // ── GET: list (public — no auth required) ──
  if (req.method === 'GET') {
    try {
      const { boardId } = req.query;
      if (!boardId) return res.status(400).json({ message: 'boardId required' });

      const { data, error } = await supabaseAdmin
        .from('community_mood_board_comments')
        .select('*, profiles!inner(name, avatar_url)')
        .eq('mood_board_id', boardId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;

      return res.status(200).json({
        comments: (data || []).map(c => ({
          id: c.id,
          content: c.content,
          createdAt: c.created_at,
          author: {
            id: c.user_id,
            name: c.profiles && c.profiles.name,
            avatarUrl: c.profiles && c.profiles.avatar_url,
          },
        })),
      });
    } catch (error) {
      console.error('List moodboard comments error:', error);
      return res.status(500).json({ message: 'Failed to fetch comments' });
    }
  }

  const user = requireAuth(req, res);
  if (!user) return;

  // ── POST: add comment ──
  if (req.method === 'POST') {
    try {
      const { boardId, content } = req.body || {};
      if (!boardId || !content || !content.trim()) {
        return res.status(400).json({ message: 'boardId and content are required' });
      }
      const trimmed = content.trim().slice(0, 2000); // cap length

      const { data, error } = await supabaseAdmin
        .from('community_mood_board_comments')
        .insert({ mood_board_id: boardId, user_id: user.id, content: trimmed })
        .select()
        .single();
      if (error) throw error;

      // Notification — tell board owner someone commented (skip self)
      try {
        const { data: board } = await supabaseAdmin
          .from('community_mood_boards')
          .select('user_id')
          .eq('id', boardId)
          .maybeSingle();
        if (board && board.user_id && board.user_id !== user.id) {
          await supabaseAdmin.from('community_notifications').insert({
            user_id: board.user_id,
            type: 'comment',
            actor_id: user.id,
            target_type: 'mood_board',
            target_id: boardId,
          });
        }
      } catch (e) { /* non-fatal */ }

      // Return enriched (with author info) so frontend can append directly
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      return res.status(201).json({
        comment: {
          id: data.id,
          content: data.content,
          createdAt: data.created_at,
          author: { id: user.id, name: profile && profile.name, avatarUrl: profile && profile.avatar_url },
        },
      });
    } catch (error) {
      console.error('Add moodboard comment error:', error);
      return res.status(500).json({ message: 'Failed to add comment' });
    }
  }

  // ── DELETE: remove own comment ──
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ message: 'id required' });

      // Owner-only delete (admins could also delete — out of scope here)
      const { error } = await supabaseAdmin
        .from('community_mood_board_comments')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
      return res.status(200).json({ deleted: true });
    } catch (error) {
      console.error('Delete moodboard comment error:', error);
      return res.status(500).json({ message: 'Failed to delete comment' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
