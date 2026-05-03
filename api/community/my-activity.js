/**
 * GET /api/community/my-activity — Aggregated counts for the caller, used to
 *   render the "내 커뮤니티 활동" block on mypage. Warm tone (not gamified) —
 *   no leaderboards, no points, just a count of what the user has done.
 *
 * Response shape:
 *   {
 *     posts: int,            // community_posts.user_id = me
 *     comments: int,         // community_comments.user_id = me
 *     likesGiven: int,       // community_likes.user_id = me
 *     moodboards: int,       // community_mood_boards.user_id = me
 *     scraps: int,           // community_scraps.user_id = me
 *     inspiredOthers: int,   // count of moodboards by OTHERS that have inspired_by_id pointing to one of MINE
 *   }
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

async function countSafe(table, userIdField, userId) {
  try {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(userIdField, userId);
    if (error) return 0;
    return count || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const [posts, comments, likesGiven, moodboards, scraps] = await Promise.all([
      countSafe('community_posts', 'user_id', user.id),
      countSafe('community_comments', 'user_id', user.id),
      countSafe('community_likes', 'user_id', user.id),
      countSafe('community_mood_boards', 'user_id', user.id),
      countSafe('community_scraps', 'user_id', user.id),
    ]);

    // Count moodboards by OTHERS that were inspired by one of mine.
    // Two-step: get my board IDs, then count boards inspired_by IN (...) AND not mine.
    let inspiredOthers = 0;
    try {
      const { data: myBoards } = await supabaseAdmin
        .from('community_mood_boards')
        .select('id')
        .eq('user_id', user.id);
      const ids = (myBoards || []).map(b => b.id);
      if (ids.length > 0) {
        const { count } = await supabaseAdmin
          .from('community_mood_boards')
          .select('*', { count: 'exact', head: true })
          .in('inspired_by_id', ids)
          .neq('user_id', user.id);
        inspiredOthers = count || 0;
      }
    } catch (e) {
      // table column may not exist yet (pre-v3 migration) — leave as 0
    }

    return res.status(200).json({
      posts, comments, likesGiven, moodboards, scraps, inspiredOthers,
    });
  } catch (error) {
    console.error('my-activity error:', error);
    return res.status(500).json({ message: 'Failed to fetch activity' });
  }
};
