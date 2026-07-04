/**
 * PAP Magazine - Articles API
 * GET  /api/articles      → 아티클 목록 조회 (공개)
 * POST /api/articles      → 아티클 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { recordContentChange, attachAuthorship } = require('../_lib/audit');

// QA #222 — auto-generate a URL slug from the title when the editor
// leaves it blank. We keep Hangul/CJK characters as-is (modern browsers
// + Vercel routes handle UTF-8 path segments fine) and only collapse
// whitespace → hyphen + strip a small set of punctuation. The result
// lets the SSR /article/:slug handler do a direct slug lookup instead
// of falling back to the fragile title-ilike path.
function generateArticleSlug(title) {
  if (!title) return null;
  const s = String(title)
    .normalize('NFC')
    .replace(/[‘’“”]/g, '')
    .replace(/[.,!?;:'"…]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
  return s || null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET: 아티클 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, category, page = 1, limit: rawLimit = 25 } = req.query;
      const limit = Math.min(Math.max(1, parseInt(rawLimit) || 25), 100);
      const offset = (parseInt(page) - 1) * limit;
      const requestedStatus = status || 'published';

      // QA #199 — 'scheduled' is a VIRTUAL status (no DB enum change).
      // Mirror of the editorials behavior shipped in QA #196:
      // rows with status='published' AND scheduled_publish_at in the
      // future. The public-list .or() gate below hides these from
      // visitors; this filter is what surfaces them to admin under the
      // "예약" tab so the editor can preview / edit / publish-now.
      const isScheduledFilter = requestedStatus === 'scheduled';

      // Drafts (and any non-published view) are admin-only — work in
      // progress should never leak to the public list.
      if (requestedStatus !== 'published') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
      }

      // QA #220 — edge cache for the anonymous public list so the
      // same Vercel POP doesn't replay the same query to Supabase
      // 28K times per day. s-maxage=60: a single fetch per POP per
      // minute. stale-while-revalidate=300: keep serving the cached
      // copy for 5 more minutes while the next refresh runs in the
      // background. Authenticated requests skip the cache to avoid
      // serving admin / staff a stale list right after they publish.
      const isPublicAnon = requestedStatus === 'published'
        && !req.headers.authorization
        && req.method === 'GET';
      if (isPublicAnon) {
        // QA #294 — Disk IO 경고 대응. s-maxage 60→300, SWR 300→3600.
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
      } else {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
      }

      // QA #186 — list-view projection drops `gallery` + `credits`.
      // QA #199 — re-include scheduled_publish_at + admin_edited_at so
      //           the admin list can render scheduled-time badges and
      //           last-edited pills without a per-row second fetch.
      // QA #221 — re-include `content` (the JSON block array). The SPA
      //           consumes /api/articles directly with fetchAll and never
      //           does a per-article second fetch, so dropping `content`
      //           here meant every block (text/image/quote/video) silently
      //           vanished on the public detail page. Article bodies are
      //           small (≤ ~10 KB for a typical post), and the QA #220
      //           edge cache means the larger payload is served almost
      //           entirely from the POP after the first hit.
      const LIST_COLUMNS = [
        'id','title','subtitle','slug','thumbnail_url','hero_image_url',
        'category','tags','published_date','custom_url','status',
        'scheduled_publish_at','admin_edited_at','updated_at',
        'content',
        // 참여 증폭 (2026-07) — SPA 기사 상세에서 "원본 IG 게시물에
        // 좋아요·저장·보내기" CTA 딥링크 소스.
        'source_instagram_url',
        // QA #202 — surface authorship in the admin list (created_at +
        // FK columns; attachAuthorship resolves to display_name).
        'created_at','created_by','updated_by'
      ].join(',');

      let query = supabaseAdmin
        .from('articles')
        .select(LIST_COLUMNS, { count: 'exact' });

      if (isScheduledFilter) {
        // QA #199 — scheduled = status='published' + future
        // scheduled_publish_at. Sort by the PUBLISH date (soonest first)
        // so the admin sees what's about to go live at the top.
        query = query.eq('status', 'published')
                     .gt('scheduled_publish_at', new Date().toISOString())
                     .order('scheduled_publish_at', { ascending: true });
      } else {
        query = query.eq('status', requestedStatus)
                     .order('published_date', { ascending: false });
      }

      if (category) {
        query = query.eq('category', category);
      }

      query = query.range(offset, offset + parseInt(limit) - 1);

      // For the public-facing 'published' view, hide articles whose
      // scheduled_publish_at is still in the future. The OR clause
      // keeps backward-compat with rows that don't have
      // scheduled_publish_at set. (isScheduledFilter already targets
      // FUTURE rows above, so we skip the gate.)
      if (requestedStatus === 'published' && !isScheduledFilter) {
        query = query.or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${new Date().toISOString()}`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      // QA #202 — batch-resolve created_by / updated_by into _creator /
      // _editor objects so the admin list can render display names.
      if (Array.isArray(data)) await attachAuthorship(data);

      // QA #186 — edge cache the published list. Drafts/scheduled stay
      // no-store because they are admin-only and change frequently.
      if (requestedStatus === 'published' && !isScheduledFilter) {
        // QA #294 — Disk IO 경고 대응.
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
      } else {
        res.setHeader('Cache-Control', 'private, no-store');
      }

      return res.status(200).json({
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / parseInt(limit))
        }
      });
    } catch (err) {
      console.error('Articles GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch articles' });
    }
  }

  // POST: 아티클 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const {
        title, subtitle, slug, published_date, category, tags,
        thumbnail_url, hero_image_url, content, gallery, credits,
        custom_url, status,
        // QA #199 — editor-tunable scheduled-publish stamp. Optional.
        scheduled_publish_at,
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      // QA #222 — when the admin leaves slug empty we fill it from the
      // title so cold-load /article/<slug> resolves on a fast indexed
      // path instead of the SSR title-ilike fallback.
      const finalSlug = (slug && slug.trim()) || generateArticleSlug(title);
      const { data, error } = await supabaseAdmin
        .from('articles')
        .insert({
          title,
          subtitle: subtitle || null,
          slug: finalSlug,
          published_date: published_date || null,
          category: category || null,
          tags: tags || [],
          thumbnail_url: thumbnail_url || null,
          hero_image_url: hero_image_url || null,
          content: content || '',
          gallery: gallery || [],
          credits: credits || [],
          custom_url: custom_url || null,
          status: status || 'published',
          scheduled_publish_at: scheduled_publish_at || null,
          // QA #202 — authorship stamps (creator == initial editor).
          created_by: user.id,
          updated_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // QA #202 — audit ledger entry.
      await recordContentChange({
        content_type: 'article',
        content_id: data.id,
        action: 'create',
        actor: user,
        summary: `뉴스 등록: ${data.title}`,
      });

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Articles POST error:', err);
      return res.status(500).json({ error: 'Failed to create article' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
