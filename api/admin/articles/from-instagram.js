/**
 * POST /api/admin/articles/from-instagram — 어드민이 IG URL 붙여넣어 기사 생성.
 *
 * QA #275. Body: { instagramUrl: string, status?: 'draft'|'published' }
 * 응답: { article: row } 또는 { error: msg }
 *
 * 이미 동일 게시물에서 import한 article이 있으면 그 row 반환 + 새로 생성 안 함.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const {
  fetchInstagramPost,
  generateArticleFromPost,
  buildArticleRow,
} = require('../../_lib/instagramImport');

module.exports = async function handler(req, res){
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAdmin(req, res);
  if (!user) return;

  const body = req.body || {};
  const url = String(body.instagramUrl || '').trim();
  if (!url) return res.status(400).json({ error: 'instagramUrl이 필요합니다.' });

  try {
    // 1) IG에서 게시물 fetch.
    const post = await fetchInstagramPost(url);

    // 2) 동일 게시물이 이미 import되어 있으면 그 row 반환.
    if (post.id){
      const { data: existing } = await supabaseAdmin
        .from('articles')
        .select('*')
        .eq('source_instagram_post_id', post.id)
        .maybeSingle();
      if (existing){
        return res.status(200).json({ article: existing, duplicate: true });
      }
    }

    // 3) Claude로 기사 생성.
    const generated = await generateArticleFromPost(post);
    const row = buildArticleRow(post, generated, { status: body.status || 'draft' });
    row.created_by = user.id;

    // 4) INSERT.
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('articles').insert(row).select().single();
    if (insErr){
      console.error('[from-instagram] insert failed:', insErr);
      return res.status(500).json({ error: 'DB insert 실패: ' + insErr.message });
    }

    return res.status(201).json({ article: inserted, duplicate: false });
  } catch (e){
    console.error('[from-instagram] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
