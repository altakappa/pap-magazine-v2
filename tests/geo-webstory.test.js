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

console.log('\n=== 스토리 사이트맵 ===');
t('깨끗한 slug 만 광고 (^[a-z0-9-]+$)', /\^\[a-z0-9-\]\+\$/.test(smap));
t('이미지 있는 화보만', /hasImage/.test(smap));
t('라우트 + 사이트맵 인덱스 등록',
  (vercel.rewrites || []).some(r => r.source === '/sitemap-stories.xml')
  && /sitemap-stories\.xml/.test(smapIdx));

console.log('\n=== AI 크롤 일별 추이 (Ⅵ-52) ===');
t('crawl.by_day 시리즈 (day × platform)', /by_day:/.test(aiTraffic) && /crawlByDay/.test(aiTraffic));
t('날짜 오름차순 정렬', /a\[0\] < b\[0\] \? -1 : 1/.test(aiTraffic));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ geo-webstory tests passed');
