/**
 * GET  /api/community/badges?userId= — Get user's badges
 * POST /api/community/badges/check  — Check & award badges based on activity (called internally)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

// Badge definitions: thresholds for level badges
const LEVEL_THRESHOLDS = {
  bronze:   { posts: 1,  comments: 5,   likes: 10,  checkins: 3  },
  silver:   { posts: 5,  comments: 20,  likes: 50,  checkins: 14 },
  gold:     { posts: 15, comments: 50,  likes: 150, checkins: 30 },
  platinum: { posts: 30, comments: 100, likes: 300, checkins: 60 },
  diamond:  { posts: 50, comments: 200, likes: 500, checkins: 100 },
};

// Achievement definitions
const ACHIEVEMENTS = [
  { name: 'first_post',    type: 'achievement', check: (s) => s.posts >= 1 },
  { name: 'first_comment',  type: 'achievement', check: (s) => s.comments >= 1 },
  { name: 'streak_7',       type: 'achievement', check: (s) => s.maxStreak >= 7 },
  { name: 'streak_30',      type: 'achievement', check: (s) => s.maxStreak >= 30 },
  { name: 'popular_post',   type: 'achievement', check: (s) => s.maxPostLikes >= 20 },
  { name: 'collab_first',   type: 'achievement', check: (s) => s.projectsCreated >= 1 || s.applicationsAccepted >= 1 },
  { name: 'collab_5',       type: 'achievement', check: (s) => s.projectsCreated + s.applicationsAccepted >= 5 },
  { name: 'social_butterfly', type: 'achievement', check: (s) => s.followers >= 10 },
  { name: 'influencer',     type: 'achievement', check: (s) => s.followers >= 50 },
];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // ── GET: List user's badges ──
  if (req.method === 'GET') {
    try {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ message: 'userId is required' });

      const { data: badges, error } = await supabaseAdmin
        .from('community_badges')
        .select('*')
        .eq('user_id', userId)
        .order('awarded_at', { ascending: false });

      if (error) throw error;

      // Determine current level
      const levelBadges = badges.filter(b => b.badge_type === 'level');
      const levels = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
      let currentLevel = null;
      for (const l of levels.reverse()) {
        if (levelBadges.find(b => b.badge_name === l)) { currentLevel = l; break; }
      }

      return res.status(200).json({
        badges: badges.map(b => ({
          id: b.id,
          type: b.badge_type,
          name: b.badge_name,
          data: b.badge_data,
          awardedAt: b.awarded_at,
        })),
        currentLevel,
      });
    } catch (error) {
      console.error('Get badges error:', error);
      return res.status(500).json({ message: 'Failed to fetch badges' });
    }
  }

  // ── POST: Check and award badges ──
  if (req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      // Gather user stats
      const [postsRes, commentsRes, likesRes, checkinsRes, projectsRes, appsRes, followersRes] = await Promise.all([
        supabaseAdmin.from('community_posts').select('id, like_count', { count: 'exact', head: false }).eq('user_id', user.id),
        supabaseAdmin.from('community_comments').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabaseAdmin.from('community_likes').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabaseAdmin.from('community_checkins').select('checked_at').eq('user_id', user.id).order('checked_at', { ascending: false }),
        supabaseAdmin.from('community_projects').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabaseAdmin.from('community_applications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'accepted'),
        supabaseAdmin.from('community_follows').select('id', { count: 'exact', head: true }).eq('following_id', user.id),
      ]);

      // Calculate max streak
      const checkinDates = (checkinsRes.data || []).map(c => c.checked_at);
      let maxStreak = 0, currentStreak = 0;
      for (let i = 0; i < checkinDates.length; i++) {
        if (i === 0) { currentStreak = 1; }
        else {
          const diff = (new Date(checkinDates[i - 1]) - new Date(checkinDates[i])) / (1000 * 60 * 60 * 24);
          currentStreak = (diff <= 1.5) ? currentStreak + 1 : 1;
        }
        maxStreak = Math.max(maxStreak, currentStreak);
      }

      const maxPostLikes = Math.max(0, ...(postsRes.data || []).map(p => p.like_count || 0));

      const stats = {
        posts: postsRes.count || 0,
        comments: commentsRes.count || 0,
        likes: likesRes.count || 0,
        checkins: checkinDates.length,
        maxStreak,
        maxPostLikes,
        projectsCreated: projectsRes.count || 0,
        applicationsAccepted: appsRes.count || 0,
        followers: followersRes.count || 0,
      };

      // Calculate total activity score for level
      const activityScore = stats.posts + stats.comments + stats.likes + stats.checkins;
      const awarded = [];

      // Check level badges
      for (const [level, thresholds] of Object.entries(LEVEL_THRESHOLDS)) {
        const qualifies = stats.posts >= thresholds.posts &&
                          stats.comments >= thresholds.comments &&
                          stats.checkins >= thresholds.checkins;
        if (qualifies) {
          const { data, error } = await supabaseAdmin
            .from('community_badges')
            .upsert({ user_id: user.id, badge_type: 'level', badge_name: level, badge_data: { activityScore } },
                     { onConflict: 'user_id,badge_name', ignoreDuplicates: true })
            .select();
          if (data && data.length) awarded.push(level);
        }
      }

      // Check achievement badges
      for (const ach of ACHIEVEMENTS) {
        if (ach.check(stats)) {
          const { data } = await supabaseAdmin
            .from('community_badges')
            .upsert({ user_id: user.id, badge_type: ach.type, badge_name: ach.name, badge_data: {} },
                     { onConflict: 'user_id,badge_name', ignoreDuplicates: true })
            .select();
          if (data && data.length) awarded.push(ach.name);
        }
      }

      return res.status(200).json({ awarded, stats });
    } catch (error) {
      console.error('Check badges error:', error);
      return res.status(500).json({ message: 'Failed to check badges' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
