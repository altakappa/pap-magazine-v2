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
const { getOrTranslate } = require('../_lib/translate');
const { assertActivePlan } = require('../_lib/subscriptionAccess');

const SUPPORTED_LANGS = new Set(['ko','en','it','fr','es','ja','zh','ru','de']);

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

        // Build base payload (untranslated)
        const items = (board.items || []).sort((a, c) => a.sort_order - c.sort_order)
          .map(i => ({ id: i.id, imageUrl: i.image_url, caption: i.caption, captionOriginal: i.caption }));
        const out = {
          id: board.id,
          title: board.title,
          titleOriginal: board.title,
          description: board.description,
          descriptionOriginal: board.description,
          tags: board.tags,
          voteCount: board.vote_count,
          createdAt: board.created_at,
          author: { id: board.user_id, name: board.profiles && board.profiles.name, avatarUrl: board.profiles && board.profiles.avatar_url },
          items,
          inspiredBy,
        };

        // Translate if ?lang= requested. Title + description + each item caption.
        // Tags are skipped — they're conceptual labels and translating them
        // breaks the "tag taxonomy" matching.
        const langParam = req.query.lang;
        const targetLang = (typeof langParam === 'string' && SUPPORTED_LANGS.has(langParam)) ? langParam : null;
        if (targetLang) {
          const [tt, dd] = await Promise.all([
            getOrTranslate('mood_board', board.id, 'title',       board.title       || '', targetLang),
            getOrTranslate('mood_board', board.id, 'description', board.description || '', targetLang),
          ]);
          out.title = tt;
          out.description = dd;
          // Captions in parallel — bounded by translateBatch's internal concurrency
          const capItems = items.filter(i => i.caption && i.caption.trim());
          const capTranslations = await Promise.all(capItems.map(i =>
            getOrTranslate('mood_board_item', i.id, 'caption', i.caption || '', targetLang)
          ));
          capItems.forEach((i, idx) => { i.caption = capTranslations[idx]; });
          out.translated = (tt !== board.title) || (dd !== board.description);
        }

        return res.status(200).json(out);
      } catch (error) {
        console.error('Get moodboard detail error:', error);
        return res.status(500).json({ message: 'Failed to fetch board' });
      }
    }

    try {
      const { userId, sort = 'recent', page = 1, lang } = req.query;
      const perPage = 20;
      const offset = (parseInt(page) - 1) * perPage;
      const targetLang = (typeof lang === 'string' && SUPPORTED_LANGS.has(lang)) ? lang : null;

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

      // Translate title (and short description preview if present) per board.
      // Captions on list-view items are NOT shown so we skip them — only the
      // title strip is rendered on cards.
      const boardsOut = await Promise.all(data.map(async b => {
        const row = {
          id: b.id,
          title: b.title,
          titleOriginal: b.title,
          description: b.description,
          tags: b.tags,
          voteCount: b.vote_count,
          previewImages: (b.items || []).sort((a, c) => a.sort_order - c.sort_order).slice(0, 4).map(i => i.image_url),
          itemCount: (b.items || []).length,
          createdAt: b.created_at,
          inspiredById: b.inspired_by_id || null,
          author: { id: b.user_id, name: b.profiles?.name, avatarUrl: b.profiles?.avatar_url },
        };
        if (targetLang) {
          row.title = await getOrTranslate('mood_board', b.id, 'title', b.title || '', targetLang);
          row.translated = (row.title !== row.titleOriginal);
        }
        return row;
      }));

      return res.status(200).json({
        boards: boardsOut,
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

          // Notification: tell the board owner someone liked it (skip self)
          try {
            const { data: board } = await supabaseAdmin
              .from('community_mood_boards')
              .select('user_id')
              .eq('id', boardId)
              .maybeSingle();
            if (board && board.user_id && board.user_id !== user.id) {
              await supabaseAdmin.from('community_notifications').insert({
                user_id: board.user_id,
                type: 'like',
                actor_id: user.id,
                target_type: 'mood_board',
                target_id: boardId,
              });
            }
          } catch (e) { /* non-fatal */ }

          return res.status(200).json({ voted: true });
        }
      } catch (error) {
        console.error('Vote error:', error);
        return res.status(500).json({ message: 'Failed to vote' });
      }
    }

    // Create mood board — 스탠다드+ 필요 (투표는 위에서 무료 통과)
    if (!(await assertActivePlan(supabaseAdmin, res, user, 'standard'))) return;
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

      // Notification: if this board was inspired by another, tell the
      // source-board owner ("✨ X님이 당신의 보드에서 영감받아 새 보드를
      // 만들었어요"). Skip if source owner is the same person.
      if (inspiredById) {
        try {
          const { data: parent } = await supabaseAdmin
            .from('community_mood_boards')
            .select('user_id')
            .eq('id', inspiredById)
            .maybeSingle();
          if (parent && parent.user_id && parent.user_id !== user.id) {
            await supabaseAdmin.from('community_notifications').insert({
              user_id: parent.user_id,
              type: 'inspiration',
              actor_id: user.id,
              target_type: 'mood_board',
              target_id: board.id, // navigate to the NEW (inspired) board, not the source
            });
          }
        } catch (e) { /* non-fatal */ }
      }

      return res.status(201).json({ board });
    } catch (error) {
      console.error('Create moodboard error:', error);
      return res.status(500).json({ message: 'Failed to create mood board' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
