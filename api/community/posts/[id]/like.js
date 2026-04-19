/**
 * POST /api/community/posts/:id/like — Toggle like on a post
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAuth } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { id: postId } = req.query;

    // Check if already liked
    const { data: existing } = await supabaseAdmin
      .from('community_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      // Unlike
      await supabaseAdmin
        .from('community_likes')
        .delete()
        .eq('id', existing.id);

      return res.status(200).json({ liked: false });
    } else {
      // Like
      await supabaseAdmin
        .from('community_likes')
        .insert({ post_id: postId, user_id: user.id });

      return res.status(200).json({ liked: true });
    }
  } catch (error) {
    console.error('Like post error:', error);
    return res.status(500).json({ message: 'Failed to toggle like' });
  }
};
