/**
 * GET /api/community/discovery
 *
 * Returns surfaces that help members find good content even when they don't
 * actively browse. All public — no auth required.
 *
 * Response:
 *   {
 *     trendingMoodboards: [{id, title, previewImage, voteCount, author:{id,name}, recencyScore}, ...],
 *     activeCreators: [{id, name, avatarUrl, scrapCount, moodboardCount}, ...],
 *     recentScraps:  [{id, imageUrl, sourceType, author:{id,name}, createdAt}, ...]
 *   }
 *
 * Trending moodboards: top by vote_count among boards created/voted in last
 * 14 days. Sorted by simple score (vote_count + age decay). If <3 results,
 * fall back to all-time top.
 *
 * Active creators: members with most scraps + moodboards in last 30 days.
 *
 * Recent scraps: latest 8 scraps overall (any user) — gives a "what's
 * happening" feel even before there are votes.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const TRENDING_WINDOW_DAYS = 14;
const ACTIVE_WINDOW_DAYS   = 30;
const MAX_TRENDING = 5;
const MAX_ACTIVE   = 5;
const MAX_RECENT_SCRAPS = 8;

function _isoDaysAgo(days){
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const out = { trendingMoodboards: [], activeCreators: [], recentScraps: [] };

  // ── Trending moodboards ──────────────────────────────────────────────
  try {
    const since = _isoDaysAgo(TRENDING_WINDOW_DAYS);

    // Recent + voted boards first
    const { data: recent } = await supabaseAdmin
      .from('community_mood_boards')
      .select('id, title, vote_count, created_at, user_id, profiles!inner(name), items:community_mood_board_items(image_url, sort_order)')
      .eq('visibility', 'public')
      .gte('created_at', since)
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(MAX_TRENDING);

    let pool = recent || [];
    // Fallback: if too few in window, top up with all-time top by votes
    if (pool.length < 3) {
      const { data: allTime } = await supabaseAdmin
        .from('community_mood_boards')
        .select('id, title, vote_count, created_at, user_id, profiles!inner(name), items:community_mood_board_items(image_url, sort_order)')
        .eq('visibility', 'public')
        .order('vote_count', { ascending: false })
        .limit(MAX_TRENDING);
      const seen = new Set(pool.map(b => b.id));
      (allTime || []).forEach(b => { if (!seen.has(b.id)) pool.push(b); });
      pool = pool.slice(0, MAX_TRENDING);
    }

    out.trendingMoodboards = pool.map(b => {
      const items = (b.items || []).slice().sort((a, c) => (a.sort_order || 0) - (c.sort_order || 0));
      return {
        id: b.id,
        title: b.title,
        previewImage: items[0] ? items[0].image_url : null,
        voteCount: b.vote_count || 0,
        author: { id: b.user_id, name: b.profiles && b.profiles.name },
        createdAt: b.created_at,
      };
    });
  } catch (e) {
    console.warn('discovery: trendingMoodboards failed:', e.message);
  }

  // ── Active creators (most scraps + moodboards in window) ─────────────
  try {
    const since = _isoDaysAgo(ACTIVE_WINDOW_DAYS);

    // Pull recent scrap authors and moodboard authors, count per user, sort
    const [{ data: scraps }, { data: boards }] = await Promise.all([
      supabaseAdmin.from('community_scraps')
        .select('user_id')
        .gte('created_at', since)
        .limit(500),
      supabaseAdmin.from('community_mood_boards')
        .select('user_id')
        .eq('visibility', 'public')
        .gte('created_at', since)
        .limit(500),
    ]);

    const counts = {};
    (scraps || []).forEach(r => { counts[r.user_id] = counts[r.user_id] || { scraps: 0, boards: 0 }; counts[r.user_id].scraps++; });
    (boards || []).forEach(r => { counts[r.user_id] = counts[r.user_id] || { scraps: 0, boards: 0 }; counts[r.user_id].boards++; });

    const ranked = Object.entries(counts)
      .map(([uid, c]) => ({ uid, scrapCount: c.scraps, moodboardCount: c.boards, score: c.scraps + c.boards * 2 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ACTIVE);

    if (ranked.length > 0) {
      const ids = ranked.map(r => r.uid);
      const { data: profs } = await supabaseAdmin
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', ids);
      const profMap = {};
      (profs || []).forEach(p => { profMap[p.id] = p; });
      out.activeCreators = ranked
        .filter(r => profMap[r.uid])
        .map(r => ({
          id: r.uid,
          name: profMap[r.uid].name,
          avatarUrl: profMap[r.uid].avatar_url,
          scrapCount: r.scrapCount,
          moodboardCount: r.moodboardCount,
        }));
    }
  } catch (e) {
    console.warn('discovery: activeCreators failed:', e.message);
  }

  // ── Recent scraps (latest N, any user) ───────────────────────────────
  try {
    const { data: scraps } = await supabaseAdmin
      .from('community_scraps')
      .select('id, image_url, source_url, source_type, created_at, user_id, profiles!inner(name)')
      .order('created_at', { ascending: false })
      .limit(MAX_RECENT_SCRAPS);
    out.recentScraps = (scraps || []).map(s => ({
      id: s.id,
      imageUrl: s.image_url,
      sourceUrl: s.source_url,
      sourceType: s.source_type,
      createdAt: s.created_at,
      author: { id: s.user_id, name: s.profiles && s.profiles.name },
    }));
  } catch (e) {
    console.warn('discovery: recentScraps failed:', e.message);
  }

  return res.status(200).json(out);
};
