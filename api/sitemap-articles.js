/**
 * PAP Magazine — Articles Sitemap
 * Lists every published article as /article/<slug|custom_url|id>.
 *
 * 2026-08-04 — 언어별 분할 + 5,000행 상한 버그 수정.
 *   [버그] seo_translations 조회가 `.limit(20000)` 이었지만 Supabase 는 5,000행에서
 *          조용히 자른다(에러 없음). 언어별 URL 이 대량 누락됐다.
 *          → fetchAllRows() 로 전량 페이지네이션.
 *   [분할] /sitemap-articles.xml         → ko(정본) + 이미지 + hreflang
 *          /sitemap-articles-<lang>.xml  → 해당 언어 URL + hreflang
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { sendOutageXml } = require('./_lib/dbOutage');
const { handleCors } = require('./_lib/cors');
const { fetchAllRows } = require('./_lib/fetchAllRows');

const SITE = 'https://www.pap-magazine.com';

// ko = 정본(prefix 없음). 나머지는 /<lang>/article/<handle>.
const VALID_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];
// 번역 테이블에 실제로 저장되는 언어(ko 원본·en 은 DB 원본 필드라 제외).
const TRANSLATED_LANGS = ['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];

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

  // ?lang= 없으면 ko(정본) 사이트맵.
  const q = String((req.query && req.query.lang) || '');
  const only = VALID_LANGS.includes(q) ? q : 'ko';

  try {
    // ⚠️ 반드시 fetchAllRows: 단일 조회는 5,000행에서 조용히 잘린다(위 헤더 참고).
    // 페이지 경계 안정성을 위해 UNIQUE 컬럼(id)로 2차 정렬한다.
    const arts = await fetchAllRows(() => supabaseAdmin
      .from('articles')
      .select('id, title, slug, custom_url, published_date, updated_at, hero_image_url, thumbnail_url')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .order('id', { ascending: true }), { pageSize: 500 });

    /* 2026-09-14 — 조회가 '성공적으로 0건' 을 주는 경우도 장애다.
       발행 기사가 0편일 수는 없다(실측 2,638편). 전송량 초과처럼 조용히 비는
       장애에서 빈 사이트맵이 200 으로 나가는 것을 막는다. */
    if (!arts || arts.length === 0) return sendOutageXml(res, 'articles 0건');

    // it/fr/es/ja/de/zh/ru 번역 존재 여부 (2026-07-26 다국어 확장) — 번역이 있는
    // 기사만 해당 언어 URL·alternate 를 선언한다. 에디토리얼 사이트맵과 동일 규칙.
    const trMap = new Map();
    try {
      const trs = await fetchAllRows(() => supabaseAdmin
        .from('seo_translations')
        .select('content_id, lang')
        .eq('kind', 'article')
        .order('id', { ascending: true }));
      for (const t of trs) {
        if (!trMap.has(t.content_id)) trMap.set(t.content_id, []);
        trMap.get(t.content_id).push(t.lang);
      }
    } catch (_) { /* ko/en only */ }

    const urls = (arts || []).map(a => {
      // 2026-07-22 (Ahrefs 감사: 사이트맵 내 301) — custom_url 은 레거시라 slug 1순위.
      const handle = a.slug || a.custom_url || a.id;
      if (!handle) return '';
      const loc = SITE + '/article/' + encodeURIComponent(handle);
      // ko/en 항상, 나머지 7개 언어는 번역 존재 시 (2026-07-26 다국어 확장).
      const langs = ['ko', 'en'].concat((trMap.get(a.id) || []).filter(l => TRANSLATED_LANGS.includes(l)));
      if (!langs.includes(only)) return '';   // 이 언어 사이트맵엔 실릴 게 없음
      const urlFor = (l) => l === 'ko' ? loc : SITE + '/' + l + '/article/' + encodeURIComponent(handle);
      const lastmod = fmtDate(a.updated_at || a.published_date);
      const altBlock =
        langs.map(l => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + xmlEscape(urlFor(l)) + '"/>\n').join('') +
        '    <xhtml:link rel="alternate" hreflang="x-default" href="' + xmlEscape(loc) + '"/>\n';

      // 이미지 블록은 ko(정본) 사이트맵에서만 — 언어별 파일에 중복하면 같은 이미지를
      // 9번 광고하게 되고 파일만 커진다.
      const img = a.hero_image_url || a.thumbnail_url;
      const imgBlock = (only === 'ko' && img)
        ? '    <image:image>\n      <image:loc>' + xmlEscape(img) + '</image:loc>\n      <image:title>' + xmlEscape(a.title || '') + '</image:title>\n    </image:image>\n'
        : '';

      return '  <url>\n' +
        '    <loc>' + xmlEscape(urlFor(only)) + '</loc>\n' +
        '    <lastmod>' + lastmod + '</lastmod>\n' +
        '    <changefreq>weekly</changefreq>\n' +
        '    <priority>' + (only === 'ko' ? '0.7' : '0.5') + '</priority>\n' +
        altBlock +
        imgBlock +
        '  </url>';
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
    /* 2026-09-14 — 빈 <urlset> 을 200 으로 주면 구글은 "기사가 0편" 으로 읽는다.
       장애 중에 그러면 사이트맵에 있던 URL 을 전부 지워도 된다는 신호가 된다.
       503 이면 직전 사이트맵을 그대로 들고 있는다. (_lib/dbOutage.js 머리말) */
    return sendOutageXml(res, 'sitemap-articles: ' + String((err && err.message) || err));
  }
};
