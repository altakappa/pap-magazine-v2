/**
 * 사이트맵·RSS 아티클 핸들 소스 (2026-07-22 Ahrefs 감사: 사이트맵 내 301 690건).
 *
 * [원인] articles 에는 정식 slug(전건 URL-clean)와 레거시 custom_url(경로형 불량
 * 268건·공백 68건)이 공존하는데, 사이트맵·RSS 가 custom_url||id 를 광고했다.
 * 그 URL 은 전부 정식 slug 로 301 → 검색엔진에 "리다이렉트만 가득한 사이트맵".
 *
 * [수정] slug || custom_url || id 순서로 광고. 이 테스트는 재발(우선순위 역전·
 * select 에서 slug 누락)을 감시한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 사이트맵·RSS slug 우선 광고 ===');
for (const f of ['api/sitemap-articles.js','api/sitemap-news.js','api/rss.js']) {
  const s = R(f);
  t(`${f}: handle 이 slug 우선`, /a\.slug \|\| a\.custom_url \|\| a\.id/.test(s));
  t(`${f}: select 에 slug 포함`, /select\('[^']*\bslug\b[^']*'\)/.test(s));
  t(`${f}: 구(舊) custom_url 우선이 없다`, !/const handle = a\.custom_url \|\| a\.id;/.test(s));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ sitemap-slug-source tests FAILED'); process.exit(1); }
console.log('✅ sitemap-slug-source tests passed');
