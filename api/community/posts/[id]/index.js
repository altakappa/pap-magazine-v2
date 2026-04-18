/**
 * DELETE /api/community/posts/:id — Delete a community post (owner or admin)
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAuth, requireAdmin } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Allow admin OR authenticated owner
  const user = requireAuth(req, res);
  if (!user) return;

  const { id: postId } = req.query;

  try {
    // Check if user is admin
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const isAdmin = profile && profile.role === 'admin';

    // If not admin, verify ownership
    if (!isAdmin) {
      const { data: post } = await supabaseAdmin
        .from('community_posts')
        .select('user_id')
        .eq('id', postId)
        .single();

      if (!post) {
        return res.status(404).json({ message: 'Post not found' });
      }
      if (post.user_id !== user.id) {
        return res.status(403).json({ message: 'Not authorized to delete this post' });
      }
    }

    // Delete related comments first
    await supabaseAdmin
      .from('community_comments')
      .delete()
      .eq('post_id', postId);

    // Delete related likes
    await supabaseAdmin
      .from('community_likes')
      .delete()
      .eq('post_id', postId);

    // Delete the post
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
};
