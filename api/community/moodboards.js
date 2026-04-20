/**
 * GET  /api/community/moodboards — List mood boards (?userId= or trending)
 * POST /api/community/moodboards — Create mood board
 * POST /api/community/moodboards?action=vote&boardId= — Vote on mood board
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // ── GET: List mood boards ──
  if (req.method === 'GET') {
    try {
      const { userId, sort = 'recent', page = 1 } = req.query;
      const perPage = 20;
      const offset = (parseInt(page) - 1) * perPage;

      let query = supabaseAdmin
        .from('community_mood_boards')
        .select('*, profiles!inner(name, avatar_url), items:community_mood_board_items(id, image_url, sort_order)', { count: 'exact' })
        .eq('visibility', 'public');

      if (userId) query = query.eq('user_id', userId);

      if (sort === 'popular') {
        query = query.order('vote_count', { ascending: false });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      query = query.range(offset, offset + perPage - 1);
      const { data, count, error } = await query;
      if (error) throw error;

      return res.status(200).json({
        boards: data.map(b => ({
          id: b.id,
          title: b.title,
          description: b.description,
          tags: b.tags,
          voteCount: b.vote_count,
          previewImages: (b.items || []).sort((a, c) => a.sort_order - c.sort_order).slice(0, 4).map(i => i.image_url),
          itemCount: (b.items || []).length,
          createdAt: b.created_at,
          author: { id: b.user_id, name: b.profiles?.name, avatarUrl: b.profiles?.avatar_url },
        })),
        total: count,
        page: parseInt(page),
        totalPages: Math.ceil(count / perPage),
      });
    } catch (error) {
      console.error('List moodboards error:', error);
      return res.status(500).json({ message: 'Failed to fetch mood boards' });
    }
  }

  const user = requireAuth(req, res);
  if (!user) return;

  // ── POST ──
  if (req.method === 'POST') {
    const { action, boardId } = req.query;

    // Vote on a mood board
    if (action === 'vote' && boardId) {
      try {
        const { data: existing } = await supabaseAdmin
          .from('community_mood_board_votes')
          .select('id')
          .eq('board_id', boardId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (existing) {
          await supabaseAdmin.from('community_mood_board_votes').delete().eq('id', existing.id);
          return res.status(200).json({ voted: false });
        } else {
          await supabaseAdmin.from('community_mood_board_votes').insert({ board_id: boardId, user_id: user.id });
          return res.status(200).json({ voted: true });
        }
      } catch (error) {
        console.error('Vote error:', error);
        return res.status(500).json({ message: 'Failed to vote' });
      }
    }

    // Create mood board
    try {
      const { title, description, tags, items } = req.body;
      if (!title) return res.status(400).json({ message: 'Title is required' });

      const { data: board, error } = await supabaseAdmin
        .from('community_mood_boards')
        .insert({ user_id: user.id, title, description: description || '', tags: tags || [] })
        .select()
        .single();

      if (error) throw error;

      // Insert items if provided
      if (items && Array.isArray(items) && items.length > 0) {
        const itemRows = items.map((item, i) => ({
          board_id: board.id,
          image_url: item.imageUrl,
          caption: item.caption || '',
          sort_order: i,
        }));
        await supabaseAdmin.from('community_mood_board_items').insert(itemRows);
      }

      return res.status(201).json({ board });
    } catch (error) {
      console.error('Create moodboard error:', error);
      return res.status(500).json({ message: 'Failed to create mood board' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
