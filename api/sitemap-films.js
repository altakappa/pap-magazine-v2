/**
 * PAP Magazine — Films + Shorts Sitemap
 *
 * Combined because both are video content. Each entry includes a
 * <video:video> child so Google Video Search can index thumbnail + title +
 * description. Without this, films/shorts only appear as plain web results.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pap-magazine.com';

function xmlEscape(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function fmtDate(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  try { return new Date(d).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); }
}

function safeSitemapHandle(h) {
  // SEO 2026-07 — advertise only URL-clean handles (mirrors sitemap.js).
  // Films/shorts are canonicalized by slug; using the title here produced
  // %20-encoded URLs that mismatched the canonical ("duplicate / redirect").
  if (h == null) return null;
  const s = String(h);
  return /^[A-Za-z0-9._~-]+$/.test(s) ? s : null;
}

function buildVideoEntry(prefix, item) {
  const handle = safeSitemapHandle(item.slug || item.id);
  if (!handle) return '';
  const loc = SITE + prefix + encodeURIComponent(handle);
  const lastmod = fmtDate(item.updated_at || item.published_date);
  const thumb = item.thumbnail_url
    || (item.youtube_id ? `https://img.youtube.com/vi/${item.youtube_id}/maxresdefault.jpg` : null);
  const yt = item.youtube_id ? `https://www.youtube.com/watch?v=${item.youtube_id}` : null;
  const desc = item.description || item.title || '';

  const videoBlock = (thumb && yt)
    ? '    <video:video>\n' +
      '      <video:thumbnail_loc>' + xmlEscape(thumb) + '</video:thumbnail_loc>\n' +
      '      <video:title>' + xmlEscape(item.title || '') + '</video:title>\n' +
      '      <video:description>' + xmlEscape(desc).slice(0, 2048) + '</video:description>\n' +
      '      <video:player_loc>' + xmlEscape(`https://www.youtube.com/embed/${item.youtube_id}`) + '</video:player_loc>\n' +
      '      <video:publication_date>' + fmtDate(item.published_date) + '</video:publication_date>\n' +
      '      <video:family_friendly>yes</video:family_friendly>\n' +
      '    </video:video>\n'
    : '';

  // /en/ SSR (2026-07-16) — 언어별 URL + hreflang alternate
  const locEn = SITE + '/en' + prefix + encodeURIComponent(handle);
  const altBlock =
    '    <xhtml:link rel="alternate" hreflang="ko" href="' + xmlEscape(loc) + '"/>\n' +
    '    <xhtml:link rel="alternate" hreflang="en" href="' + xmlEscape(locEn) + '"/>\n' +
    '    <xhtml:link rel="alternate" hreflang="x-default" href="' + xmlEscape(loc) + '"/>\n';
  return '  <url>\n' +
    '    <loc>' + xmlEscape(loc) + '</loc>\n' +
    '    <lastmod>' + lastmod + '</lastmod>\n' +
    '    <changefreq>monthly</changefreq>\n' +
    '    <priority>0.7</priority>\n' +
    altBlock +
    videoBlock +
    '  </url>\n' +
    '  <url>\n' +
    '    <loc>' + xmlEscape(locEn) + '</loc>\n' +
    '    <lastmod>' + lastmod + '</lastmod>\n' +
    '    <changefreq>monthly</changefreq>\n' +
    '    <priority>0.5</priority>\n' +
    altBlock +
    '  </url>';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    const [filmsRes, shortsRes] = await Promise.all([
      supabaseAdmin.from('films')
        .select('id, title, slug, youtube_id, thumbnail_url, published_date, updated_at')
        .eq('status', 'published').order('published_date', { ascending: false }).limit(2000),
      supabaseAdmin.from('shorts')
        .select('id, title, youtube_id, thumbnail_url, published_date, updated_at')
        .eq('status', 'published').order('published_date', { ascending: false }).limit(2000)
    ]);

    const urls = [
      ...(filmsRes.data || []).map(f => buildVideoEntry('/film/', f)),
      ...(shortsRes.data || []).map(s => buildVideoEntry('/short/', s))
    ].filter(Boolean);

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"\n' +
      '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
      urls.join('\n') + '\n' +
      '</urlset>\n';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap-films] error', err);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
  }
};
