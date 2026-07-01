/**
 * PAP Magazine — Server-Side Rendered Film Page (SEO)
 * Route: /film/:slug   (rewritten in vercel.json)
 *
 * Films don't have slugs (only id + title + youtube_id), so we match
 * against title (URL-decoded) and id. The renderer emits a VideoObject
 * schema using the YouTube thumbnail + embed URL — gives Google a
 * proper video card in search.
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
    return res.status(404).send(renderNotFoundHtml('film', ''));
  }

  const decoded = (() => { try { return decodeURIComponent(slug); } catch { return slug; } })();
  // QA #222 — match the SPA's title-as-URL transform: hyphens → spaces.
  const dehyphenated = decoded.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    let data = null;

    /* 1) Try slug column (some films do have slugs) */
    let r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
      .eq('slug', slug).eq('status', 'published').limit(1).maybeSingle();
    data = r.data;

    /* 2) Title match (films are commonly addressed by title) */
    if (!data) {
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('title', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 2b) title with hyphens stripped — QA #222 */
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('title', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 2c) title ilike — QA #222 */
    if (!data && dehyphenated.length >= 3) {
      const safe = dehyphenated.replace(/[\\%_]/g, ch => '\\' + ch);
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .ilike('title', safe).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3) youtube_id match (legacy URLs sometimes use the YT video id) */
    if (!data) {
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('youtube_id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 4) UUID id (admin-share links) */
    if (!data && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    if (!data) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      return res.status(404).send(renderNotFoundHtml('film', slug));
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large, max-video-preview:-1');
    return res.status(200).send(renderSeoHtml('film', data));

  } catch (err) {
    console.error('[seo/film] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('film', slug));
  }
};
