/**
 * GET  /api/community/posts/:id/comments — Get comments for a post
 * POST /api/community/posts/:id/comments — Add a comment
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAuth } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { id: postId } = req.query;

  // ── GET: List comments ──
  if (req.method === 'GET') {
    try {
      const { data: comments, error } = await supabaseAdmin
        .from('community_comments')
        .select('*, profiles!inner(name, avatar_url)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return res.status(200).json({
        comments: comments.map(c => ({
          id: c.id,
          content: c.content,
          createdAt: c.created_at,
          author: {
            id: c.user_id,
            name: c.profiles?.name,
            avatarUrl: c.profiles?.avatar_url,
          },
        })),
      });
    } catch (error) {
      console.error('Get comments error:', error);
      return res.status(500).json({ message: 'Failed to fetch comments' });
    }
  }

  // ── POST: Add comment ──
  if (req.method === 'POST') {
    try {
      const { content } = req.body;

      if (!content) {
        return res.status(400).json({ message: 'Comment content is required' });
      }

      const { data: comment, error } = await supabaseAdmin
        .from('community_comments')
        .insert({
          post_id: postId,
          user_id: user.id,
          content,
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ comment });
    } catch (error) {
      console.error('Add comment error:', error);
      return res.status(500).json({ message: 'Failed to add comment' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
