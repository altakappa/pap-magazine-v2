/**
 * GET  /api/community/posts  — List posts (?tag=&page=&lang=)
 * POST /api/community/posts  — Create a new post
 *
 * When ?lang= is provided, post title + content are auto-translated via
 * api/_lib/translate.js (cached in community_translations). The original
 * fields are also returned as `titleOriginal` / `contentOriginal` so the
 * frontend can offer a "show original" toggle.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAuth } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { getOrTranslate } = require('../../_lib/translate');

const SUPPORTED_LANGS = new Set(['ko','en','it','fr','es','ja','zh','ru','de']);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // ── GET: List posts ──
  if (req.method === 'GET') {
    try {
      const { tag, page = 1, lang } = req.query;
      const perPage = 20;
      const offset = (parseInt(page) - 1) * perPage;
      const targetLang = (typeof lang === 'string' && SUPPORTED_LANGS.has(lang)) ? lang : null;

      let query = supabaseAdmin
        .from('community_posts')
        .select('*, profiles!inner(name, avatar_url, instagram)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + perPage - 1);

      if (tag) {
        query = query.eq('tag', tag);
      }

      const { data: posts, count, error } = await query;
      if (error) throw error;

      const translated = await Promise.all(posts.map(async p => {
        const out = {
          id: p.id,
          title: p.title,
          content: p.content,
          titleOriginal: p.title,
          contentOriginal: p.content,
          tag: p.tag,
          likeCount: p.like_count,
          commentCount: p.comment_count,
          createdAt: p.created_at,
          author: {
            id: p.user_id,
            name: p.profiles?.name,
            avatarUrl: p.profiles?.avatar_url,
            instagram: p.profiles?.instagram,
          },
        };
        if (targetLang) {
          const [t, c] = await Promise.all([
            getOrTranslate('post', p.id, 'title',   p.title   || '', targetLang),
            getOrTranslate('post', p.id, 'content', p.content || '', targetLang),
          ]);
          out.title = t;
          out.content = c;
          out.translated = (t !== p.title) || (c !== p.content);
        }
        return out;
      }));

      return res.status(200).json({
        posts: translated,
        total: count,
        page: parseInt(page),
        totalPages: Math.ceil(count / perPage),
      });
    } catch (error) {
      console.error('List posts error:', error);
      return res.status(500).json({ message: 'Failed to fetch posts' });
    }
  }

  // ── POST: Create post ──
  if (req.method === 'POST') {
    try {
      const { title, content, tag } = req.body;

      if (!title || !content) {
        return res.status(400).json({ message: 'Title and content are required' });
      }

      const { data: post, error } = await supabaseAdmin
        .from('community_posts')
        .insert({
          user_id: user.id,
          title,
          content,
          tag: tag || 'discussion',
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ post });
    } catch (error) {
      console.error('Create post error:', error);
      return res.status(500).json({ message: 'Failed to create post' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
