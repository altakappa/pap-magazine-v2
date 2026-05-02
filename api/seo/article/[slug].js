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

    /* 3) title match */
    if (!data) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('title', decoded).eq('status', 'published').limit(1).maybeSingle();
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
