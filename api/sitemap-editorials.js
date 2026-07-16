/**
 * PAP Magazine — Editorials Sitemap
 * Lists every published editorial as /editorial/<slug> with image:image entries.
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
    // QA #187 — gallery now joins so the sitemap can advertise EVERY
    // editorial image to Google Image Search, not just the cover.
    // Google caps at ~1000 images per <url>, but we cap at 30 to keep
    // each sitemap fast to crawl + keep the file < 10MB.
    const { data: eds } = await supabaseAdmin
      .from('editorials')
      .select('id, title, slug, published_date, updated_at, cover_image, og_image, thumbnail, gallery')
      .eq('status', 'published')
      .or('scheduled_publish_at.is.null,scheduled_publish_at.lte.' + new Date().toISOString())
      .order('published_date', { ascending: false })
      .limit(5000);

    // it/fr/es 번역 존재 여부 (2026-07-16, 다국어 2단계) — 번역이 있는
    // 에디토리얼만 해당 언어 URL·alternate 를 선언한다. 테이블 미생성/실패
    // 시엔 ko/en 만으로 동작.
    const trMap = new Map();
    try {
      const { data: trs } = await supabaseAdmin
        .from('seo_translations')
        .select('content_id, lang')
        .eq('kind', 'editorial')
        .limit(20000);
      for (const t of trs || []) {
        if (!trMap.has(t.content_id)) trMap.set(t.content_id, []);
        trMap.get(t.content_id).push(t.lang);
      }
    } catch (_) { /* ko/en only */ }

    const urls = (eds || []).map(ed => {
      const handle = ed.slug || ed.id;
      if (!handle) return '';
      const loc = SITE + '/editorial/' + encodeURIComponent(handle);
      // 언어별 URL + hreflang alternate (2026-07-16) — ko/en 항상, it/fr/es 는 번역 존재 시.
      const langs = ['ko', 'en'].concat((trMap.get(ed.id) || []).filter(l => ['it', 'fr', 'es'].includes(l)));
      const urlFor = (l) => l === 'ko' ? loc : SITE + '/' + l + '/editorial/' + encodeURIComponent(handle);
      const lastmod = fmtDate(ed.updated_at || ed.published_date);
      const altBlock =
        langs.map(l => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + xmlEscape(urlFor(l)) + '"/>\n').join('') +
        '    <xhtml:link rel="alternate" hreflang="x-default" href="' + xmlEscape(loc) + '"/>\n';

      // Build image:image entries — cover first, then up to 29 gallery
      // images. Dedupe so the cover doesn't repeat if it's also the
      // first gallery slot. Each entry advertises:
      //   • image:loc      → the URL Google crawls
      //   • image:title    → editorial title (anchors brand search)
      //   • image:caption  → "Editorial Title — Look N" for context
      const seen = new Set();
      const imgs = [];
      const cover = ed.og_image || ed.cover_image || ed.thumbnail;
      if (cover) {
        seen.add(cover);
        imgs.push({ src: cover, caption: (ed.title || '') + ' — Cover' });
      }
      const gallery = Array.isArray(ed.gallery) ? ed.gallery : [];
      gallery.forEach((src, i) => {
        if (typeof src !== 'string' || !src || seen.has(src)) return;
        if (imgs.length >= 30) return;
        seen.add(src);
        imgs.push({ src, caption: (ed.title || '') + ' — Look ' + (i + 1) });
      });

      const imgBlocks = imgs.map(it =>
        '    <image:image>\n' +
        '      <image:loc>' + xmlEscape(it.src) + '</image:loc>\n' +
        '      <image:title>' + xmlEscape(ed.title || '') + '</image:title>\n' +
        '      <image:caption>' + xmlEscape(it.caption) + '</image:caption>\n' +
        '    </image:image>\n'
      ).join('');

      return '  <url>\n' +
        '    <loc>' + xmlEscape(loc) + '</loc>\n' +
        '    <lastmod>' + lastmod + '</lastmod>\n' +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>0.8</priority>\n' +
        altBlock +
        imgBlocks +
        '  </url>\n' +
        // 언어 변형 — 이미지 블록은 ko 항목이 이미 선언했으므로 생략(파일 크기 절약).
        langs.filter(l => l !== 'ko').map(l =>
          '  <url>\n' +
          '    <loc>' + xmlEscape(urlFor(l)) + '</loc>\n' +
          '    <lastmod>' + lastmod + '</lastmod>\n' +
          '    <changefreq>monthly</changefreq>\n' +
          '    <priority>0.6</priority>\n' +
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
    console.error('[sitemap-editorials] error', err);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
  }
};
