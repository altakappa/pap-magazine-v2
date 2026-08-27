/**
 * PAP Magazine — Web Story (Ⅵ-51, 확장전략55 — 2026-08-27 신설)
 * Route: /stories/:slug → /api/seo/story-editorial/:slug (vercel.json)
 *
 * 왜: Web Stories 는 구글 전용 표면(디스커버·이미지·검색 캐러셀)이고 화보와
 * 궁합이 정확하다. 프레임워크 없이 amp-story 마크업을 SSR 로 만든다.
 *
 * 페이월 정합 (절대 규칙 — 구독 게이트 약화 금지):
 * 스토리에 싣는 이미지는 커버 + editorialAccess.PREVIEW_IMAGES(=2)장 —
 * SSR 상세 페이지의 비열람자 허용량과 동일한 상수를 쓴다. 마지막 페이지는
 * 전체 화보로 가는 CTA. 스토리는 미리보기이지 우회로가 아니다.
 */

'use strict';

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { PREVIEW_IMAGES } = require('../../_lib/editorialAccess');

const SITE = 'https://www.pap-magazine.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function creditLine(credits) {
  if (!Array.isArray(credits)) return '';
  const parts = [];
  for (const c of credits.slice(0, 10)) {
    if (!c || !c.name) continue;
    const role = Array.isArray(c.roles) && c.roles.length ? c.roles[0] : '';
    parts.push(role ? role + ' — ' + c.name : c.name);
  }
  return parts.join(' · ').slice(0, 300);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const slug = String((req.query && req.query.slug) || '').trim();
  if (!slug) return res.status(404).send('Not found');

  try {
    const { data: ed, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, title_en, slug, description, description_en, cover_image, thumbnail, gallery, credits, published_date, updated_at')
      .eq('slug', slug.toLowerCase())
      .eq('status', 'published')
      .maybeSingle();
    if (error) throw error;
    if (!ed) return res.status(404).send('Not found');

    const canonical = SITE + '/stories/' + encodeURIComponent(ed.slug);
    const editorialUrl = SITE + '/editorial/' + encodeURIComponent(ed.slug);
    const cover = ed.cover_image || ed.thumbnail || '';
    const gallery = (Array.isArray(ed.gallery) ? ed.gallery : [])
      .filter(u => typeof u === 'string' && u)
      .slice(0, PREVIEW_IMAGES); // 페이월 미리보기 허용량과 동일
    if (!cover && !gallery.length) return res.status(404).send('Not found');

    const title = ed.title || '';
    const desc = (ed.description || ed.description_en || '').replace(/\s+/g, ' ').trim();
    const descShort = desc.length > 180 ? desc.slice(0, 180) + '…' : desc;
    const credit = creditLine(ed.credits);
    const published = ed.published_date ? String(ed.published_date).slice(0, 10) : '';

    const imgPages = gallery.map((u, i) => `
  <amp-story-page id="look-${i + 1}">
    <amp-story-grid-layer template="fill">
      <amp-img src="${esc(u)}" width="720" height="1280" layout="responsive" alt="${esc(title)} — Look ${i + 1}"></amp-img>
    </amp-story-grid-layer>
    ${credit && i === gallery.length - 1 ? `
    <amp-story-grid-layer template="thirds">
      <div grid-area="lower-third" class="caption">${esc(credit)}</div>
    </amp-story-grid-layer>` : ''}
  </amp-story-page>`).join('\n');

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      mainEntityOfPage: canonical,
      image: [cover, ...gallery].filter(Boolean),
      datePublished: published || undefined,
      dateModified: ed.updated_at || undefined,
      publisher: {
        '@type': 'Organization', name: 'PAP Magazine',
        logo: { '@type': 'ImageObject', url: SITE + '/pap-logo.png' },
      },
    };

    const html = `<!doctype html>
<html amp lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(title)} | PAP MAGAZINE Web Story</title>
<link rel="canonical" href="${esc(canonical)}">
<meta name="viewport" content="width=device-width,minimum-scale=1,initial-scale=1">
<meta name="description" content="${esc(descShort)}">
<script async src="https://cdn.ampproject.org/v0.js"></script>
<script async custom-element="amp-story" src="https://cdn.ampproject.org/v0/amp-story-1.0.js"></script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style amp-boilerplate>body{-webkit-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-moz-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-ms-animation:-amp-start 8s steps(1,end) 0s 1 normal both;animation:-amp-start 8s steps(1,end) 0s 1 normal both}@-webkit-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-moz-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-ms-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-o-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}</style><noscript><style amp-boilerplate>body{-webkit-animation:none;-moz-animation:none;-ms-animation:none;animation:none}</style></noscript>
<style amp-custom>
  amp-story { font-family: 'Montserrat','Apple SD Gothic Neo',sans-serif; }
  .title-panel { background: rgba(0,0,0,.55); padding: 24px; }
  .title-panel h1 { color: #fff; font-size: 26px; line-height: 1.3; margin: 0 0 10px; }
  .title-panel p { color: rgba(255,255,255,.85); font-size: 14px; line-height: 1.6; margin: 0; }
  .caption { background: rgba(0,0,0,.55); color: rgba(255,255,255,.85); font-size: 12px; line-height: 1.6; padding: 14px 18px; }
  .cta-panel { background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 32px; }
  .cta-panel .brand { color: #c33b3b; font-size: 11px; letter-spacing: .35em; text-transform: uppercase; font-weight: 700; margin-bottom: 18px; }
  .cta-panel h2 { color: #fff; font-size: 22px; line-height: 1.4; margin: 0 0 12px; }
  .cta-panel p { color: rgba(255,255,255,.65); font-size: 13px; line-height: 1.7; }
</style>
</head>
<body>
<amp-story standalone
  title="${esc(title)}"
  publisher="PAP MAGAZINE"
  publisher-logo-src="${SITE}/pap-logo.png"
  poster-portrait-src="${esc(cover || gallery[0])}">

  <amp-story-page id="cover">
    <amp-story-grid-layer template="fill">
      <amp-img src="${esc(cover || gallery[0])}" width="720" height="1280" layout="responsive" alt="${esc(title)} — Cover"></amp-img>
    </amp-story-grid-layer>
    <amp-story-grid-layer template="thirds">
      <div grid-area="lower-third" class="title-panel">
        <h1>${esc(title)}</h1>
        ${descShort ? `<p>${esc(descShort)}</p>` : ''}
      </div>
    </amp-story-grid-layer>
  </amp-story-page>
${imgPages}
  <amp-story-page id="cta">
    <amp-story-grid-layer template="fill">
      <div class="cta-panel">
        <div class="brand">PAP MAGAZINE</div>
        <h2>${esc(title)}</h2>
        <p>전체 화보와 크레딧은 PAP MAGAZINE에서 볼 수 있습니다.</p>
      </div>
    </amp-story-grid-layer>
    <amp-story-page-outlink layout="nodisplay">
      <a href="${esc(editorialUrl)}?utm_source=webstory">전체 화보 보기</a>
    </amp-story-page-outlink>
  </amp-story-page>
</amp-story>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[story-editorial]', (err && err.message) || err);
    return res.status(500).send('temporary error');
  }
};
