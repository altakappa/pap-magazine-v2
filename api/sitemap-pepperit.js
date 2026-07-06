/**
 * GET /sitemap-pepperit.xml — 페퍼릿(pepperitmag.com) 기사 사이트맵.
 * 최근 기사는 Google News 규격(news:news)도 함께 선언 (48시간 이내).
 */

const { supabaseAdmin } = require('./_lib/supabase');

const SITE = 'https://www.pepperitmag.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  try {
    const { data } = await supabaseAdmin.from('pepperit_articles')
      .select('slug, id, title, published_date')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(1000);

    const cutoff = Date.now() - 48 * 3600000;
    const urls = (data || []).map((a) => {
      const loc = SITE + '/article/' + encodeURIComponent(a.slug || a.id);
      const d = a.published_date || new Date().toISOString();
      const isNews = new Date(d).getTime() >= cutoff;
      return '<url><loc>' + esc(loc) + '</loc><lastmod>' + esc(String(d).slice(0, 10)) + '</lastmod>' +
        (isNews
          ? '<news:news><news:publication><news:name>PEPPERIT</news:name><news:language>ko</news:language></news:publication>' +
            '<news:publication_date>' + esc(d) + '</news:publication_date>' +
            '<news:title>' + esc(a.title) + '</news:title></news:news>'
          : '') +
        '</url>';
    }).join('');

    const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">' +
      '<url><loc>' + SITE + '/pepperit</loc></url>' + urls + '</urlset>';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap-pepperit] error:', err);
    return res.status(500).send('error');
  }
};
