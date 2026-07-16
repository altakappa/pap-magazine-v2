/**
 * PAP Magazine — Server-Side Rendered Article Page (SEO)
 * Route: /article/:slug   (rewritten in vercel.json)
 *
 * Same shape as /editorial/:slug but for the `articles` table:
 *   - schema.org NewsArticle (Google rich-result eligible for news/articles)
 *   - falls back across slug → custom_url → title → UUID id
 *   - renders rich-text `content` field if present
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { renderSeoHtml, renderNotFoundHtml } = require('../../_lib/seoRenderer');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).end();
  }

  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(renderNotFoundHtml('article', ''));
  }

  const decoded = (() => { try { return decodeURIComponent(slug); } catch { return slug; } })();
  // QA #222 — articles authored via the admin "뉴스" flow usually leave
  // slug + custom_url NULL, so the SPA renders the title-as-URL with
  // spaces replaced by hyphens (자크뮈스가-담아낸-...). The SSR must
  // mirror that transform on the way back in: when no exact match is
  // found, swap `-` → ` ` and try the title column with both equality
  // (fast path) and ilike (forgiving of trailing punctuation / extra
  // spaces). We also try the slug column with the same dash-space swap
  // so a partially-slugified record still resolves.
  const dehyphenated = decoded.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    let data = null;

    /* 1) custom_url match (articles use custom_url for SEO slugs) */
    let r = await supabaseAdmin.from('articles').select('*')
      .eq('custom_url', slug).eq('status', 'published').limit(1).maybeSingle();
    data = r.data;

    /* 2) decoded custom_url */
    if (!data && decoded !== slug) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('custom_url', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 2b) slug column (decoded + dehyphenated) — QA #222 */
    if (!data) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('slug', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('slug', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3) title match (exact) */
    if (!data) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('title', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3b) title match with hyphens stripped — QA #222 */
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('title', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3c) title ilike (forgiving of trailing punctuation / whitespace) — QA #222 */
    if (!data && dehyphenated.length >= 3) {
      const safe = dehyphenated.replace(/[\\%_]/g, ch => '\\' + ch);
      r = await supabaseAdmin.from('articles').select('*')
        .ilike('title', safe).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 4) UUID id (legacy /article/<id>) */
    if (!data && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    if (!data) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      return res.status(404).send(renderNotFoundHtml('article', slug));
    }

    /* QA(2026-07) #7 — 정규 슬러그로 301 리다이렉트.
     *
     * 기사 URL 이 한글 인코딩(%EA%B2%90%EC%A1%B0…)과 영문 슬러그로 혼재해
     * 공유·SEO·가독성이 나빴다. 슬러그를 ASCII 로 정리하면 옛 한글 URL 은
     * custom_url 조회(위 1단계)로 계속 해석되는데, 그대로 200 을 주면 같은
     * 기사가 두 URL 로 색인되는 중복 콘텐츠가 된다.
     *
     * 그래서 요청 경로가 정규 슬러그(data.slug)와 다르면 301 로 정규 URL 에
     * 넘긴다 → 옛 공유 링크는 살아있고(끊기지 않음), 색인·공유는 새 ASCII URL
     * 하나로 수렴한다. data.slug 가 없거나 이미 정규면 리다이렉트하지 않는다
     * (루프 방지).
     */
    const canonicalSlug = (data.slug || '').trim();
    if (canonicalSlug && canonicalSlug !== decoded && canonicalSlug !== slug) {
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400');
      res.setHeader('Location', '/article/' + encodeURIComponent(canonicalSlug));
      return res.status(301).end();
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');
    return res.status(200).send(renderSeoHtml('article', data, { lang: req.query.lang === 'en' ? 'en' : 'ko' }));

  } catch (err) {
    console.error('[seo/article] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('article', slug));
  }
};
