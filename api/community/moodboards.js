/**
 * GET  /api/community/moodboards                  — List mood boards (?userId=, ?sort=, ?page=)
 * GET  /api/community/moodboards?id=...           — Single board detail (with items + inspired_by ancestor)
 * POST /api/community/moodboards                  — Create mood board (body: title, description, tags, items, inspiredById?)
 * POST /api/community/moodboards?action=vote&boardId= — Toggle vote on mood board
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // ── GET: detail or list ──
  if (req.method === 'GET') {
    // Single board detail
    if (req.query.id) {
      try {
        const { data: board, error } = await supabaseAdmin
          .from('community_mood_boards')
          .select('*, profiles!inner(name, avatar_url), items:community_mood_board_items(id, image_url, caption, sort_order)')
          .eq('id', req.query.id)
          .maybeSingle();
        if (error) throw error;
        if (!board) return res.status(404).json({ message: 'Not found' });

        let inspiredBy = null;
        if (board.inspired_by_id) {
          const { data: parent } = await supabaseAdmin
            .from('community_mood_boards')
            .select('id, title, user_id, profiles!inner(name)')
            .eq('id', board.inspired_by_id)
            .maybeSingle();
          if (parent) inspiredBy = { id: parent.id, title: parent.title, authorName: parent.profiles && parent.profiles.name };
        }

        return res.status(200).json({
          id: board.id,
          title: board.title,
          description: board.description,
          tags: board.tags,
          voteCount: board.vote_count,
          createdAt: board.created_at,
          author: { id: board.user_id, name: board.profiles && board.profiles.name, avatarUrl: board.profiles && board.profiles.avatar_url },
          items: (board.items || []).sort((a, c) => a.sort_order - c.sort_order).map(i => ({ id: i.id, imageUrl: i.image_url, caption: i.caption })),
          inspiredBy,
        });
      } catch (error) {
        console.error('Get moodboard detail error:', error);
        return res.status(500).json({ message: 'Failed to fetch board' });
      }
    }

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
          inspiredById: b.inspired_by_id || null,
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
      const { title, description, tags, items, inspiredById } = req.body;
      if (!title) return res.status(400).json({ message: 'Title is required' });

      const insertRow = { user_id: user.id, title, description: description || '', tags: tags || [] };
      if (inspiredById) insertRow.inspired_by_id = inspiredById;

      const { data: board, error } = await supabaseAdmin
        .from('community_mood_boards')
        .insert(insertRow)
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
