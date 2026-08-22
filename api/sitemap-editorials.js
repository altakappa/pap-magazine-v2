/**
 * PAP Magazine — Editorials Sitemap
 * Lists every published editorial as /editorial/<slug> with image:image entries.
 *
 * 2026-08-04 — 언어별 분할 + 5,000행 상한 버그 수정.
 *   [버그] seo_translations 조회가 `.limit(20000)` 이었지만 Supabase 는 5,000행에서
 *          조용히 자른다(에러 없음). 그 결과 언어별 URL 이 2,29x편 중 67x편만
 *          광고돼 약 11,200개 번역 페이지가 검색엔진에 알려지지 않았다.
 *          → fetchAllRows() 로 전량 페이지네이션.
 *   [분할] 전량을 한 파일에 담으면 ~40MB 가 된다. 그래서
 *          /sitemap-editorials.xml            → ko(정본) + 이미지 + hreflang
 *          /sitemap-editorials-<lang>.xml     → 해당 언어 URL + hreflang
 *          9개 파일 모두 sitemap-index.xml·robots.txt 에 등록.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');
const { fetchAllRows } = require('./_lib/fetchAllRows');

const SITE = 'https://www.pap-magazine.com';

// ko = 정본(prefix 없음). 나머지는 /<lang>/editorial/<slug>.
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

function safeSitemapHandle(h) {
  // SEO 2026-07 — only advertise URL-clean handles. Malformed slugs (spaces,
  // control chars, %, apostrophes, ligatures, etc.) emit %20-encoded duplicate
  // URLs Google flags as "duplicate / page with redirect". Skip them; the page
  // stays reachable, it just isn't advertised until the slug is cleaned in DB.
  if (h == null) return null;
  const s = String(h);
  return /^[A-Za-z0-9._~-]+$/.test(s) ? s : null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // ?lang= 없으면 ko(정본) 사이트맵.
  const q = String((req.query && req.query.lang) || '');
  const only = VALID_LANGS.includes(q) ? q : 'ko';

  try {
    // QA #187 — gallery now joins so the sitemap can advertise EVERY
    // editorial image to Google Image Search, not just the cover.
    // Google caps at ~1000 images per <url>, but we cap at 30 to keep
    // each sitemap fast to crawl + keep the file well under 50MB.
    const nowIso = new Date().toISOString();
    const eds = await fetchAllRows(() => supabaseAdmin
      .from('editorials')
      .select('id, title, slug, published_date, updated_at, cover_image, og_image, thumbnail, gallery')
      .eq('status', 'published')
      .or('scheduled_publish_at.is.null,scheduled_publish_at.lte.' + nowIso)
      .order('published_date', { ascending: false })
      .order('id', { ascending: true }), { pageSize: 500 });

    // 번역 존재 여부 — 번역이 있는 에디토리얼만 해당 언어 URL·alternate 를 선언한다.
    // 테이블 미생성/실패 시엔 ko/en 만으로 동작.
    // ⚠️ 반드시 fetchAllRows: 단일 조회는 5,000행에서 조용히 잘린다(위 헤더 참고).
    const trMap = new Map();
    try {
      const trs = await fetchAllRows(() => supabaseAdmin
        .from('seo_translations')
        .select('content_id, lang')
        .eq('kind', 'editorial')
        .order('id', { ascending: true }));
      for (const t of trs) {
        if (!trMap.has(t.content_id)) trMap.set(t.content_id, []);
        trMap.get(t.content_id).push(t.lang);
      }
    } catch (_) { /* ko/en only */ }

    const urls = (eds || []).map(ed => {
      const handle = safeSitemapHandle(ed.slug || ed.id);
      if (!handle) return '';
      const loc = SITE + '/editorial/' + encodeURIComponent(handle);
      // ko/en 항상, 나머지 7개 언어는 번역 존재 시.
      const langs = ['ko', 'en'].concat((trMap.get(ed.id) || []).filter(l => TRANSLATED_LANGS.includes(l)));
      if (!langs.includes(only)) return '';   // 이 언어 사이트맵엔 실릴 게 없음
      const urlFor = (l) => l === 'ko' ? loc : SITE + '/' + l + '/editorial/' + encodeURIComponent(handle);
      const lastmod = fmtDate(ed.updated_at || ed.published_date);
      const altBlock =
        langs.map(l => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + xmlEscape(urlFor(l)) + '"/>\n').join('') +
        '    <xhtml:link rel="alternate" hreflang="x-default" href="' + xmlEscape(loc) + '"/>\n';

      // 이미지 블록은 ko(정본) 사이트맵에서만 선언한다 — 언어별 파일에 중복하면
      // 같은 이미지를 9번 광고하게 되고 파일만 커진다.
      let imgBlocks = '';
      if (only === 'ko') {
        // cover first, then up to 29 gallery images. Dedupe so the cover doesn't
        // repeat if it's also the first gallery slot. Each entry advertises:
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
        /* 2026-08-21 — 본편 이미지는 더 이상 광고하지 않는다.
         * 에디토리얼 열람이 로그인·구독 게이트 뒤로 들어갔는데, 이 사이트맵은
         * 편당 최대 29장의 원본 URL 을 인증 없이 공개 XML 로 뿌리고 있었다.
         * 게이트를 걸어도 여기서 아카이브 전체가 그대로 새 나간다.
         * 표지는 목록에서도 보이는 것이라 남긴다 — 페이지 색인과 브랜드
         * 이미지 검색은 표지만으로 유지된다. */
        const gallery = [];
        gallery.forEach((src, i) => {
          if (typeof src !== 'string' || !src || seen.has(src)) return;
          if (imgs.length >= 30) return;
          seen.add(src);
          imgs.push({ src, caption: (ed.title || '') + ' — Look ' + (i + 1) });
        });
        imgBlocks = imgs.map(it =>
          '    <image:image>\n' +
          '      <image:loc>' + xmlEscape(it.src) + '</image:loc>\n' +
          '      <image:title>' + xmlEscape(ed.title || '') + '</image:title>\n' +
          '      <image:caption>' + xmlEscape(it.caption) + '</image:caption>\n' +
          '    </image:image>\n'
        ).join('');
      }

      return '  <url>\n' +
        '    <loc>' + xmlEscape(urlFor(only)) + '</loc>\n' +
        '    <lastmod>' + lastmod + '</lastmod>\n' +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>' + (only === 'ko' ? '0.8' : '0.6') + '</priority>\n' +
        altBlock +
        imgBlocks +
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
    console.error('[sitemap-editorials] error', err);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
  }
};
