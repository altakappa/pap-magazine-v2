/**
 * GET    /api/community/follows?userId=&type=followers|following — List followers/following
 * POST   /api/community/follows — Follow a user
 * DELETE /api/community/follows?targetId= — Unfollow a user
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // ── GET: List followers or following ──
  if (req.method === 'GET') {
    try {
      const { userId, type = 'followers' } = req.query;
      if (!userId) return res.status(400).json({ message: 'userId is required' });

      let query;
      if (type === 'followers') {
        query = supabaseAdmin
          .from('community_follows')
          .select('*, profiles:follower_id(id, name, avatar_url, instagram)')
          .eq('following_id', userId)
          .order('created_at', { ascending: false });
      } else {
        query = supabaseAdmin
          .from('community_follows')
          .select('*, profiles:following_id(id, name, avatar_url, instagram)')
          .eq('follower_id', userId)
          .order('created_at', { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw error;

      return res.status(200).json({
        users: data.map(f => ({
          id: f.profiles?.id,
          name: f.profiles?.name,
          avatarUrl: f.profiles?.avatar_url,
          instagram: f.profiles?.instagram,
          followedAt: f.created_at,
        })),
        count: data.length,
      });
    } catch (error) {
      console.error('List follows error:', error);
      return res.status(500).json({ message: 'Failed to fetch follows' });
    }
  }

  const user = requireAuth(req, res);
  if (!user) return;

  // ── POST: Follow a user ──
  if (req.method === 'POST') {
    try {
      const { targetId } = req.body;
      if (!targetId) return res.status(400).json({ message: 'targetId is required' });
      if (targetId === user.id) return res.status(400).json({ message: 'Cannot follow yourself' });

      const { data, error } = await supabaseAdmin
        .from('community_follows')
        .insert({ follower_id: user.id, following_id: targetId })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') return res.status(409).json({ message: 'Already following' });
        throw error;
      }

      // Create notification for the followed user
      await supabaseAdmin.from('community_notifications').insert({
        user_id: targetId,
        type: 'follow',
        actor_id: user.id,
        message: 'started following you',
      });

      return res.status(201).json({ follow: data });
    } catch (error) {
      console.error('Follow error:', error);
      return res.status(500).json({ message: 'Failed to follow' });
    }
  }

  // ── DELETE: Unfollow a user ──
  if (req.method === 'DELETE') {
    try {
      const { targetId } = req.query;
      if (!targetId) return res.status(400).json({ message: 'targetId is required' });

      const { error } = await supabaseAdmin
        .from('community_follows')
        .delete()
        .eq('follower_id', user.id)
        .eq('following_id', targetId);

      if (error) throw error;
      return res.status(200).json({ message: 'Unfollowed' });
    } catch (error) {
      console.error('Unfollow error:', error);
      return res.status(500).json({ message: 'Failed to unfollow' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
