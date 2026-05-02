/**
 * PAP Magazine — Articles Sitemap
 * Lists every published article as /article/<custom_url|id>.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pap-magazine.com';

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function fmtDate(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  try { return new Date(d).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    const { data: arts } = await supabaseAdmin
      .from('articles')
      .select('id, title, custom_url, published_date, updated_at, hero_image_url, thumbnail_url')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(5000);

    const urls = (arts || []).map(a => {
      const handle = a.custom_url || a.id;
      if (!handle) return '';
      const loc = SITE + '/article/' + encodeURIComponent(handle);
      const lastmod = fmtDate(a.updated_at || a.published_date);
      const img = a.hero_image_url || a.thumbnail_url;
      const imgBlock = img
        ? '    <image:image>\n      <image:loc>' + xmlEscape(img) + '</image:loc>\n      <image:title>' + xmlEscape(a.title || '') + '</image:title>\n    </image:image>\n'
        : '';
      return '  <url>\n' +
        '    <loc>' + xmlEscape(loc) + '</loc>\n' +
        '    <lastmod>' + lastmod + '</lastmod>\n' +
        '    <changefreq>weekly</changefreq>\n' +
        '    <priority>0.7</priority>\n' +
        imgBlock +
        '  </url>';
    }).filter(Boolean);

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
      urls.join('\n') + '\n' +
      '</urlset>\n';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap-articles] error', err);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
  }
};
