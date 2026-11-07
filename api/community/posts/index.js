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
const { MAX, hasDangerousHtml, cleanText } = require('../../_lib/userHtml');
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
        return res.status(400).json({ message: 'Title and content are required', code: 'POST_FIELDS_REQUIRED' });
      }

      /* 2026-11-07 보안감사 H-1 — 예전엔 title·content 를 **그대로** INSERT 했다.
         길이 제한도, 위험 패턴 검사도 없었다. 근거와 역할 분담은 _lib/userHtml.js 주석 참조:
         여기는 거부 목록 트립와이어이고, 진짜 보증은 출력 단계의 papSanitizeHtml 이다. */
      const _title = cleanText(title, MAX.title);
      const _content = String(content).slice(0, MAX.content);
      if (!_title || !_content.trim()) {
        return res.status(400).json({ message: 'Title and content are required', code: 'POST_FIELDS_REQUIRED' });
      }
      if (String(title).length > MAX.title || String(content).length > MAX.content) {
        return res.status(400).json({ message: 'Title or content is too long', code: 'POST_TOO_LONG' });
      }
      if (hasDangerousHtml(_title) || hasDangerousHtml(_content)) {
        /* 조용히 깎아내지 않고 되돌린다 — '깎았지만 여전히 위험한' 중간 상태를 안 만든다. */
        return res.status(400).json({ message: 'This content cannot be saved. Please remove embedded scripts or markup.', code: 'POST_UNSAFE_HTML' });
      }
      const ALLOWED_TAGS = ['discussion', 'notice', 'free', 'behind', 'qa', 'equipment', 'jobs', 'portfolio'];
      const _tag = ALLOWED_TAGS.includes(String(tag || '')) ? String(tag) : 'discussion';

      const { data: post, error } = await supabaseAdmin
        .from('community_posts')
        .insert({
          user_id: user.id,
          title: _title,
          content: _content,
          tag: _tag,
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
