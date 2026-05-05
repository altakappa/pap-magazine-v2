/**
 * GET  /api/community/posts/:id/comments — Get comments for a post
 * POST /api/community/posts/:id/comments — Add a comment
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAuth } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');
const { getOrTranslate } = require('../../../_lib/translate');

const SUPPORTED_LANGS = new Set(['ko','en','it','fr','es','ja','zh','ru','de']);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const { id: postId } = req.query;

  // ── GET: List comments ──
  if (req.method === 'GET') {
    try {
      const { lang } = req.query;
      const targetLang = (typeof lang === 'string' && SUPPORTED_LANGS.has(lang)) ? lang : null;

      const { data: comments, error } = await supabaseAdmin
        .from('community_comments')
        .select('*, profiles!inner(name, avatar_url)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const out = await Promise.all(comments.map(async c => {
        const row = {
          id: c.id,
          content: c.content,
          contentOriginal: c.content,
          createdAt: c.created_at,
          author: {
            id: c.user_id,
            name: c.profiles?.name,
            avatarUrl: c.profiles?.avatar_url,
          },
        };
        if (targetLang) {
          row.content = await getOrTranslate('post_comment', c.id, 'content', c.content || '', targetLang);
          row.translated = (row.content !== row.contentOriginal);
        }
        return row;
      }));

      return res.status(200).json({ comments: out });
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

      // Notification: tell the post owner someone commented (skip self-comments)
      try {
        const { data: post } = await supabaseAdmin
          .from('community_posts')
          .select('user_id')
          .eq('id', postId)
          .maybeSingle();
        if (post && post.user_id && post.user_id !== user.id) {
          await supabaseAdmin.from('community_notifications').insert({
            user_id: post.user_id,
            type: 'comment',
            actor_id: user.id,
            target_type: 'post',
            target_id: postId,
          });
        }
      } catch (e) { /* notification failure is non-fatal */ }

      return res.status(201).json({ comment });
    } catch (error) {
      console.error('Add comment error:', error);
      return res.status(500).json({ message: 'Failed to add comment' });
    }
  }

  // ── DELETE: Remove a comment (owner or admin) ──
  if (req.method === 'DELETE') {
    try {
      const { commentId } = req.body || {};

      if (!commentId) {
        return res.status(400).json({ message: 'commentId is required' });
      }

      // Check if user is admin
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      const isAdmin = profile && profile.role === 'admin';

      // If not admin, verify ownership
      if (!isAdmin) {
        const { data: comment } = await supabaseAdmin
          .from('community_comments')
          .select('user_id')
          .eq('id', commentId)
          .single();

        if (!comment) {
          return res.status(404).json({ message: 'Comment not found' });
        }
        if (comment.user_id !== user.id) {
          return res.status(403).json({ message: 'Not authorized to delete this comment' });
        }
      }

      const { error } = await supabaseAdmin
        .from('community_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;

      // Decrement comment count
      await supabaseAdmin.rpc('decrement_comment_count', { p_post_id: postId }).catch(() => {
        // If RPC doesn't exist, try manual update
        supabaseAdmin
          .from('community_posts')
          .select('comment_count')
          .eq('id', postId)
          .single()
          .then(({ data }) => {
            if (data) {
              supabaseAdmin
                .from('community_posts')
                .update({ comment_count: Math.max(0, (data.comment_count || 0) - 1) })
                .eq('id', postId);
            }
          });
      });

      return res.status(200).json({ message: 'Comment deleted' });
    } catch (error) {
      console.error('Delete comment error:', error);
      return res.status(500).json({ message: 'Failed to delete comment' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
