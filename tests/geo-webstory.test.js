/**
 * Ⅵ-51 Web Story + Ⅵ-52 AI 크롤 일별 추이 — 가드 (2026-08-27)
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const story = rd('api/seo/story-editorial/[slug].js');
const smap = rd('api/sitemap-stories.js');
const smapIdx = rd('api/sitemap-index.js');
const vercel = JSON.parse(rd('vercel.json'));
const aiTraffic = rd('api/admin/ai-traffic.js');

console.log('=== Web Story (Ⅵ-51) ===');
t('페이월 정합 — editorialAccess.PREVIEW_IMAGES 상수 사용 (하드코딩 금지)',
  /require\('\.\.\/\.\.\/_lib\/editorialAccess'\)/.test(story)
  && /\.slice\(0, PREVIEW_IMAGES\)/.test(story)
  && !/slice\(0, 2\)/.test(story));
t('발행 화보만 (status published + maybeSingle)',
  /eq\('status', 'published'\)/.test(story) && /maybeSingle/.test(story));
t('amp-story 필수 요소 (standalone·publisher·poster·boilerplate)',
  /<amp-story standalone/.test(story) && /publisher-logo-src/.test(story)
  && /poster-portrait-src/.test(story) && /amp-boilerplate/.test(story));
t('CTA 아웃링크가 전체 화보로 + utm', /amp-story-page-outlink/.test(story) && /utm_source=webstory/.test(story));
t('출력 이스케이프 (esc 사용)', /esc\(title\)/.test(story) && /esc\(u\)/.test(story));
t('스토리 라우트 (/stories/:slug)',
  (vercel.rewrites || []).some(r => r.source === '/stories/:slug'
    && r.destination === '/api/seo/story-editorial/:slug'));

console.log('\n=== AMP CSP (2026-08-27 라이브 실측으로 발견) ===');
{
  /* 라이브에서 AMP 런타임이 통째로 죽어 있었다 — 전역 CSP 의 script-src 에
     cdn.ampproject.org 가 없어 v0.js 가 차단됐다(window.AMP undefined,
     body visibility:hidden, 이미지 0장). 스토리 경로 전용 CSP 로 연다. */
  const blocks = (vercel.headers || []).filter(h => h.source === '/stories/(.*)');
  t('스토리 경로 CSP 블록 존재', blocks.length === 1);
  const csp = blocks.length ? (blocks[0].headers.find(k => k.key === 'Content-Security-Policy') || {}).value || '' : '';
  const seg = (d) => (csp.split(d)[1] || '').split(';')[0];
  t('script-src 에 cdn.ampproject.org', seg('script-src').includes('cdn.ampproject.org'));
  t('style-src·img-src 에도 허용',
    seg('style-src').includes('cdn.ampproject.org') && seg('img-src').includes('cdn.ampproject.org'));
  /* 2026-08-27 2차 실측 — script-src 만 열었더니 런타임은 떴는데 이미지가 0장이었다.
     콘솔: "Bundle not found for language ko: XHR Failed fetching(cdn.ampproject.org)".
     AMP 런타임은 언어 번들 등을 **XHR** 로 가져온다 → connect-src 가 필수다. */
  t('connect-src 에 cdn.ampproject.org (AMP 언어 번들 XHR)',
    seg('connect-src').includes('cdn.ampproject.org'));
  t('스토리 CSP 가 전역보다 뒤에 온다 (같은 키는 뒤가 이긴다)',
    (vercel.headers || []).map(h => h.source).lastIndexOf('/stories/(.*)')
      > (vercel.headers || []).map(h => h.source).indexOf('/(.*)'));
  t('전역 CSP 는 그대로 (스토리 밖에는 AMP 를 열지 않는다)',
    !(((vercel.headers || []).find(h => h.source === '/(.*)') || { headers: [] })
      .headers.find(k => k.key === 'Content-Security-Policy') || {}).value.includes('ampproject'));
}

console.log('\n=== 스토리 사이트맵 ===');
t('깨끗한 slug 만 광고 (^[a-z0-9-]+$)', /\^\[a-z0-9-\]\+\$/.test(smap));
/* 2026-08-27 — 조건이 'cover 존재'에서 '진짜 이미지 존재'로 강화됐다
   (플레이스홀더 SVG·죽은 드라이브 제외 — real-image-guard 참조). */
t('진짜 이미지 있는 화보만', /hasRealImagery\(e\)/.test(smap));
t('라우트 + 사이트맵 인덱스 등록',
  (vercel.rewrites || []).some(r => r.source === '/sitemap-stories.xml')
  && /sitemap-stories\.xml/.test(smapIdx));

console.log('\n=== AI 크롤 일별 추이 (Ⅵ-52) ===');
t('crawl.by_day 시리즈 (day × platform)', /by_day:/.test(aiTraffic) && /crawlByDay/.test(aiTraffic));
t('날짜 오름차순 정렬', /a\[0\] < b\[0\] \? -1 : 1/.test(aiTraffic));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ geo-webstory tests passed');
