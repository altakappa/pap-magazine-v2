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

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');
    return res.status(200).send(renderSeoHtml('article', data));

  } catch (err) {
    console.error('[seo/article] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('article', slug));
  }
};
