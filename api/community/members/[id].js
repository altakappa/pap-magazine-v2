/**
 * GET /api/community/members/:id  — Full member profile.
 *
 * Public read (no auth required). Returns:
 *   profile:   { id, name, role, avatarUrl, bio, location, instagram, website,
 *                subscriptionPlan }
 *   counts:    { posts, moodboards, scraps, inspiredOthers, followers, following }
 *   recentMoodboards: [{ id, title, previewImage, voteCount, createdAt }, ...]   (≤6)
 *   recentScraps:     [{ id, imageUrl, sourceType, createdAt }, ...]              (≤8)
 *   isFollowing: bool — only true when the caller is logged in AND follows this id.
 *                false for logged-out viewers OR self (caller looking at own id).
 *
 * Used by the rich profile overlay in community-v2.js (mission G — member
 * profile page). Older demo-mode openProfile(name) flow still works in
 * parallel for hardcoded sample data.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { verifyToken } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { getOrTranslate } = require('../../_lib/translate');

const SUPPORTED_LANGS = new Set(['ko','en','it','fr','es','ja','zh','ru','de']);

async function _count(table, field, value) {
  try {
    const { count } = await supabaseAdmin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(field, value);
    return count || 0;
  } catch (e) { return 0; }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ message: 'id required' });

  const caller = verifyToken(req); // may be null

  try {
    // ── Profile ──
    const { data: prof, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id, name, role, avatar_url, bio, location, instagram, website, subscription_plan')
      .eq('id', id)
      .maybeSingle();
    if (profErr) throw profErr;
    if (!prof) return res.status(404).json({ message: 'Member not found' });

    // ── Counts (parallel) ──
    const [posts, moodboards, scraps, followers, following] = await Promise.all([
      _count('community_posts',       'user_id',     id),
      _count('community_mood_boards', 'user_id',     id),
      _count('community_scraps',      'user_id',     id),
      _count('community_follows',     'following_id', id),
      _count('community_follows',     'follower_id',  id),
    ]);

    // inspiredOthers: count of OTHER users' boards that have inspired_by_id
    // pointing to one of THIS user's boards.
    let inspiredOthers = 0;
    try {
      const { data: ownBoardIds } = await supabaseAdmin
        .from('community_mood_boards')
        .select('id')
        .eq('user_id', id);
      const ids = (ownBoardIds || []).map(b => b.id);
      if (ids.length > 0) {
        const { count } = await supabaseAdmin
          .from('community_mood_boards')
          .select('*', { count: 'exact', head: true })
          .in('inspired_by_id', ids)
          .neq('user_id', id);
        inspiredOthers = count || 0;
      }
    } catch (e) { /* non-fatal */ }

    // ── Recent moodboards (≤6) ──
    let recentMoodboards = [];
    try {
      const { data: boards } = await supabaseAdmin
        .from('community_mood_boards')
        .select('id, title, vote_count, created_at, items:community_mood_board_items(image_url, sort_order)')
        .eq('user_id', id)
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(6);
      recentMoodboards = (boards || []).map(b => {
        const items = (b.items || []).slice().sort((a, c) => (a.sort_order || 0) - (c.sort_order || 0));
        return {
          id: b.id,
          title: b.title,
          previewImage: items[0] ? items[0].image_url : null,
          voteCount: b.vote_count || 0,
          createdAt: b.created_at,
        };
      });
    } catch (e) { /* non-fatal */ }

    // ── Recent scraps (≤8) ──
    let recentScraps = [];
    try {
      const { data: ss } = await supabaseAdmin
        .from('community_scraps')
        .select('id, image_url, source_type, source_url, created_at')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(8);
      recentScraps = (ss || []).map(s => ({
        id: s.id,
        imageUrl: s.image_url,
        sourceUrl: s.source_url,
        sourceType: s.source_type,
        createdAt: s.created_at,
      }));
    } catch (e) { /* non-fatal */ }

    // ── isFollowing (caller-aware) ──
    let isFollowing = false;
    if (caller && caller.id && caller.id !== id) {
      try {
        const { data: f } = await supabaseAdmin
          .from('community_follows')
          .select('id')
          .eq('follower_id', caller.id)
          .eq('following_id', id)
          .maybeSingle();
        isFollowing = !!f;
      } catch (e) { /* non-fatal */ }
    }

    // Translate bio if ?lang= requested
    const langParam = req.query.lang;
    const targetLang = (typeof langParam === 'string' && SUPPORTED_LANGS.has(langParam)) ? langParam : null;
    let bioTranslated = prof.bio;
    if (targetLang && prof.bio) {
      bioTranslated = await getOrTranslate('profile_bio', prof.id, 'bio', prof.bio, targetLang);
    }
    // Translate moodboard titles in the embedded recent list (cap each call)
    if (targetLang && recentMoodboards.length > 0) {
      await Promise.all(recentMoodboards.map(async b => {
        b.titleOriginal = b.title;
        b.title = await getOrTranslate('mood_board', b.id, 'title', b.title || '', targetLang);
      }));
    }

    return res.status(200).json({
      profile: {
        id: prof.id,
        name: prof.name,
        role: prof.role,
        avatarUrl: prof.avatar_url,
        bio: bioTranslated,
        bioOriginal: prof.bio,
        location: prof.location,
        instagram: prof.instagram,
        website: prof.website,
        subscriptionPlan: prof.subscription_plan,
      },
      counts: { posts, moodboards, scraps, inspiredOthers, followers, following },
      recentMoodboards,
      recentScraps,
      isFollowing,
      isSelf: !!(caller && caller.id === id),
    });
  } catch (error) {
    console.error('Member profile error:', error);
    return res.status(500).json({ message: 'Failed to load profile' });
  }
};
