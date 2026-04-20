/**
 * PUT    /api/community/posts/:id — Edit a community post (owner or admin)
 * DELETE /api/community/posts/:id — Delete a community post (owner or admin)
 * PATCH  /api/community/posts/:id — Pin/unpin a post (admin only)
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAuth, requireAdmin } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const allowed = ['PUT', 'DELETE', 'PATCH'];
  if (!allowed.includes(req.method)) {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const { id: postId } = req.query;

  // Helper: check admin + ownership
  async function getRole() {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    return profile && profile.role === 'admin';
  }

  // ── PUT: Edit post ──
  if (req.method === 'PUT') {
    try {
      const isAdmin = await getRole();
      if (!isAdmin) {
        const { data: post } = await supabaseAdmin
          .from('community_posts')
          .select('user_id')
          .eq('id', postId)
          .single();
        if (!post) return res.status(404).json({ message: 'Post not found' });
        if (post.user_id !== user.id) {
          return res.status(403).json({ message: 'Not authorized to edit this post' });
        }
      }

      const { title, content, tag, image_url } = req.body;
      if (!title || !content) {
        return res.status(400).json({ message: 'Title and content are required' });
      }

      const updates = { title, content, updated_at: new Date().toISOString() };
      if (tag) updates.tag = tag;
      if (image_url !== undefined) updates.image_url = image_url;

      const { data: updated, error } = await supabaseAdmin
        .from('community_posts')
        .update(updates)
        .eq('id', postId)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ post: updated });
    } catch (error) {
      console.error('Edit post error:', error);
      return res.status(500).json({ message: 'Failed to edit post' });
    }
  }

  // ── PATCH: Pin/unpin post (admin only) ──
  if (req.method === 'PATCH') {
    try {
      const isAdmin = await getRole();
      if (!isAdmin) {
        return res.status(403).json({ message: 'Admin only' });
      }

      const { pinned } = req.body;
      const { data: updated, error } = await supabaseAdmin
        .from('community_posts')
        .update({ pinned: !!pinned, updated_at: new Date().toISOString() })
        .eq('id', postId)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ post: updated });
    } catch (error) {
      console.error('Pin post error:', error);
      return res.status(500).json({ message: 'Failed to pin/unpin post' });
    }
  }

  // ── DELETE: Delete post ──
  if (req.method === 'DELETE') {
    try {
      const isAdmin = await getRole();
      if (!isAdmin) {
        const { data: post } = await supabaseAdmin
          .from('community_posts')
          .select('user_id')
          .eq('id', postId)
          .single();
        if (!post) return res.status(404).json({ message: 'Post not found' });
        if (post.user_id !== user.id) {
          return res.status(403).json({ message: 'Not authorized to delete this post' });
        }
      }

      // Delete related data first
      await supabaseAdmin.from('community_comments').delete().eq('post_id', postId);
      await supabaseAdmin.from('community_likes').delete().eq('post_id', postId);

      const { error } = await supabaseAdmin
        .from('community_posts')
        .delete()
        .eq('id', postId);

      if (error) throw error;
      return res.status(200).json({ message: 'Post deleted successfully' });
    } catch (error) {
      console.error('Delete post error:', error);
      return res.status(500).json({ message: 'Failed to delete post' });
    }
  }
};
