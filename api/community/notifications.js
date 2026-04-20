/**
 * GET   /api/community/notifications — List user's notifications
 * PATCH /api/community/notifications — Mark notifications as read
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // ── GET: List notifications ──
  if (req.method === 'GET') {
    try {
      const { unreadOnly, page = 1 } = req.query;
      const perPage = 30;
      const offset = (parseInt(page) - 1) * perPage;

      let query = supabaseAdmin
        .from('community_notifications')
        .select('*, actor:actor_id(name, avatar_url)', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + perPage - 1);

      if (unreadOnly === 'true') {
        query = query.eq('read', false);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      // Count unread
      const { count: unreadCount } = await supabaseAdmin
        .from('community_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);

      return res.status(200).json({
        notifications: data.map(n => ({
          id: n.id,
          type: n.type,
          targetType: n.target_type,
          targetId: n.target_id,
          message: n.message,
          read: n.read,
          createdAt: n.created_at,
          actor: n.actor ? { name: n.actor.name, avatarUrl: n.actor.avatar_url } : null,
        })),
        total: count,
        unreadCount: unreadCount || 0,
      });
    } catch (error) {
      console.error('List notifications error:', error);
      return res.status(500).json({ message: 'Failed to fetch notifications' });
    }
  }

  // ── PATCH: Mark as read ──
  if (req.method === 'PATCH') {
    try {
      const { ids, all } = req.body;

      if (all) {
        // Mark all as read
        const { error } = await supabaseAdmin
          .from('community_notifications')
          .update({ read: true })
          .eq('user_id', user.id)
          .eq('read', false);
        if (error) throw error;
      } else if (ids && Array.isArray(ids)) {
        const { error } = await supabaseAdmin
          .from('community_notifications')
          .update({ read: true })
          .in('id', ids)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        return res.status(400).json({ message: 'Provide ids array or all: true' });
      }

      return res.status(200).json({ message: 'Marked as read' });
    } catch (error) {
      console.error('Mark read error:', error);
      return res.status(500).json({ message: 'Failed to mark as read' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
