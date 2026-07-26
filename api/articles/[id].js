/**
 * PAP Magazine - Article Detail API
 * GET    /api/articles/:id   → 아티클 상세 조회 (공개)
 * PUT    /api/articles/:id   → 아티클 수정 (관리자)
 * DELETE /api/articles/:id   → 아티클 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { recordContentChange, diffFields, attachAuthorship } = require('../_lib/audit');

// QA #202 — fields tracked in the audit diff for articles.
const ARTICLE_AUDIT_FIELDS = [
  'title','subtitle','slug','status','category','published_date',
  'scheduled_publish_at','thumbnail_url','hero_image_url','content',
  'tags','credits','custom_url'
];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('articles')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Article not found' });
      }

      // QA #202 — denormalised authorship for the admin detail view.
      await attachAuthorship([data]);

      // 2026-07-26 — 다국어 리더: seo_translations(article) 를 title_i18n/content_i18n
      // 로 실어 SPA 리더가 활성 언어의 번역 제목·본문을 렌더한다. ko/en 은 원본 컬럼.
      try {
        const { data: _trs } = await supabaseAdmin
          .from('seo_translations')
          .select('lang, title, body')
          .eq('kind', 'article')
          .eq('content_id', id);
        const _ti = {}, _ci = {};
        if (data.title) _ti.ko = data.title;
        if (data.title_en) _ti.en = data.title_en;
        if (data.content) _ci.ko = data.content;
        if (data.content_en) _ci.en = data.content_en;
        for (const r of (_trs || [])) {
          if (r && r.title) _ti[r.lang] = r.title;
          if (r && r.body)  _ci[r.lang] = r.body;
        }
        data.title_i18n = _ti;
        data.content_i18n = _ci;
      } catch (_) { /* best-effort — 번역 없으면 기존 en 폴백 유지 */ }

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Article GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch article' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      // QA #199 — added scheduled_publish_at to the allowlist so the
      // admin form can save a "publish at this future moment" stamp.
      const allowed = [
        'title', 'subtitle', 'slug', 'published_date', 'category', 'tags',
        'thumbnail_url', 'hero_image_url', 'content', 'gallery', 'credits',
        'custom_url', 'status', 'scheduled_publish_at'
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      // QA #222 — if the editor clears the slug (or sends ''), regenerate
      // it from the title so the SSR /article/<slug> route resolves on
      // the indexed slug column. We deliberately only auto-fill on empty
      // input (not on every save) so existing public URLs stay stable.
      if (updates.slug !== undefined && !String(updates.slug || '').trim()) {
        const titleForSlug = updates.title !== undefined ? updates.title : (req.body.title || null);
        const auto = (function gen(t){
          if (!t) return null;
          const s = String(t).normalize('NFC')
            .replace(/[‘’“”]/g, '')
            .replace(/[.,!?;:'"…]/g, '')
            .replace(/\s+/g, '-').replace(/-+/g, '-')
            .replace(/^-|-$/g, '').slice(0, 200);
          return s || null;
        })(titleForSlug);
        if (auto) updates.slug = auto;
      }

      // QA #202 — fetch full prior row for both transition detection
      // and audit diff (mirrors editorials/[id].js).
      let priorStatus = null;
      let priorRow = null;
      {
        const { data: prior } = await supabaseAdmin
          .from('articles')
          .select('*')
          .eq('id', id)
          .single();
        priorRow = prior || null;
        priorStatus = prior ? prior.status : null;
        if (updates.status !== undefined) {
          const becomingPublished = updates.status === 'published' && priorStatus !== 'published';
          if (becomingPublished && updates.published_date === undefined && (!prior || !prior.published_date)) {
            updates.published_date = new Date().toISOString();
          }
        }
      }

      // QA #199 — stamp admin_edited_at on every admin PUT so the
      // Drafts tab can tell "actually curated by an admin" from any
      // future auto-staged rows (matching QA #197 for editorials).
      updates.admin_edited_at = new Date().toISOString();
      // QA #202 — record who pressed Save.
      updates.updated_by = user.id;

      const { data, error } = await supabaseAdmin
        .from('articles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // QA #202 — audit ledger entry with diff.
      try {
        const diff = diffFields(priorRow, updates, ARTICLE_AUDIT_FIELDS);
        let action = 'update';
        let summary;
        if (updates.status && priorStatus && updates.status !== priorStatus) {
          if (updates.status === 'published')         { action = 'publish';   summary = `공개 전환 (이전: ${priorStatus})`; }
          else if (priorStatus === 'published')       { action = 'unpublish'; summary = `${updates.status} 으로 비공개 전환`; }
        }
        await recordContentChange({
          content_type: 'article',
          content_id: id,
          action,
          actor: user,
          summary,
          diff,
        });
      } catch(_){}

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Article PUT error:', err);
      return res.status(500).json({ error: 'Failed to update article' });
    }
  }

  // DELETE: 삭제
  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      let priorTitle = null;
      try {
        const { data: prior } = await supabaseAdmin
          .from('articles').select('title').eq('id', id).single();
        priorTitle = prior ? prior.title : null;
      } catch(_){}

      const { error } = await supabaseAdmin
        .from('articles')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // QA #202 — audit ledger.
      await recordContentChange({
        content_type: 'article',
        content_id: id,
        action: 'delete',
        actor: user,
        summary: priorTitle ? `삭제: ${priorTitle}` : '뉴스 삭제',
      });

      return res.status(200).json({ message: 'Article deleted' });
    } catch (err) {
      console.error('Article DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete article' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
