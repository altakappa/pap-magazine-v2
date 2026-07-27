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
      .select('id, title, slug, custom_url, published_date, updated_at, hero_image_url, thumbnail_url')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5000);

    // it/fr/es/ja 번역 존재 여부 (2026-07-26 다국어 확장) — 번역이 있는 기사만
    // 해당 언어 URL·alternate 를 선언한다. 에디토리얼 사이트맵과 동일 규칙.
    // (이미 만들어진 번역을 구글에 알려 해당 언어 검색에 노출.)
    const trMap = new Map();
    try {
      const { data: trs } = await supabaseAdmin
        .from('seo_translations')
        .select('content_id, lang')
        .eq('kind', 'article')
        .limit(20000);
      for (const t of trs || []) {
        if (!trMap.has(t.content_id)) trMap.set(t.content_id, []);
        trMap.get(t.content_id).push(t.lang);
      }
    } catch (_) { /* ko/en only */ }

    const urls = (arts || []).map(a => {
      // 2026-07-22 (Ahrefs 감사: 사이트맵 내 301) — custom_url 은 레거시라 slug 1순위.
      const handle = a.slug || a.custom_url || a.id;
      if (!handle) return '';
      const loc = SITE + '/article/' + encodeURIComponent(handle);
      // ko/en 항상, it/fr/es/ja 는 번역 존재 시 (2026-07-26 다국어 확장).
      const langs = ['ko', 'en'].concat((trMap.get(a.id) || []).filter(l => ['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'].includes(l)));
      const urlFor = (l) => l === 'ko' ? loc : SITE + '/' + l + '/article/' + encodeURIComponent(handle);
      const lastmod = fmtDate(a.updated_at || a.published_date);
      const altBlock =
        langs.map(l => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + xmlEscape(urlFor(l)) + '"/>\n').join('') +
        '    <xhtml:link rel="alternate" hreflang="x-default" href="' + xmlEscape(loc) + '"/>\n';
      const img = a.hero_image_url || a.thumbnail_url;
      const imgBlock = img
        ? '    <image:image>\n      <image:loc>' + xmlEscape(img) + '</image:loc>\n      <image:title>' + xmlEscape(a.title || '') + '</image:title>\n    </image:image>\n'
        : '';
      return '  <url>\n' +
        '    <loc>' + xmlEscape(loc) + '</loc>\n' +
        '    <lastmod>' + lastmod + '</lastmod>\n' +
        '    <changefreq>weekly</changefreq>\n' +
        '    <priority>0.7</priority>\n' +
        altBlock +
        imgBlock +
        '  </url>\n' +
        langs.filter(l => l !== 'ko').map(l =>
          '  <url>\n' +
          '    <loc>' + xmlEscape(urlFor(l)) + '</loc>\n' +
          '    <lastmod>' + lastmod + '</lastmod>\n' +
          '    <changefreq>weekly</changefreq>\n' +
          '    <priority>0.5</priority>\n' +
          altBlock +
          '  </url>'
        ).join('\n');
    }).filter(Boolean);

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"\n' +
      '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
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
