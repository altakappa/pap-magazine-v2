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
// 2026-08-07 — 유니크 제약 위반을 사람이 읽는 안내로 (발행 8연속 실패 사고)
const { describePgError } = require('../_lib/pgError');
// 2026-08-08 — MORE ARTICLES. SSR([slug].js)과 같은 빌더를 써서 SPA 상세도
// 같은 이전/다음/관련 기사를 받는다. 없으면 사이트 안에서 클릭해 들어온
// 사람에게는 이 섹션이 존재하지 않았다(도메니코의 "화면이 두 벌" 지적).
const { buildMoreArticles } = require('../_lib/moreArticles');

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

      // 2026-08-08 — MORE ARTICLES (SSR 과 동일 규칙, 공용 빌더).
      // 공개 기사에만 붙인다 — 관리자가 draft 를 열 때는 필요 없고 쿼리만 든다.
      if (data.status === 'published') {
        try { data.more_articles = await buildMoreArticles(data); }
        catch (_) { /* best-effort — 없으면 SPA 가 섹션을 숨긴다 */ }
      }

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
      // 2026-08-07 — 에디토리얼과 같은 처리 (_lib/pgError.js 주석 참고)
      const known = describePgError(err);
      if (known) return res.status(known.status).json(known.body);
      return res.status(500).json({ error: 'Failed to update article', code: 'update_failed' });
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
