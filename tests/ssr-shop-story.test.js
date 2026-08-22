/**
 * SHOP THE STORY 양면 렌더 회귀 (2026-08-18, 이축 전제: 어필·구독 = 글로벌 게임).
 *
 * SPA 에는 2026-08-10 부터 있었지만, 글로벌 유입(핀터레스트·AI검색·구글)이
 * 처음 밟는 SSR 페이지에는 작은 '구매' 칩뿐이었다. 수익 표면은 글로벌
 * 방문자의 첫 페이지에 있어야 한다 — SSR 에도 같은 섹션을 렌더한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ssr = R('api/_lib/seoRenderer.js');
const spa = R('frontend/pap-content-editorial.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  \u2713',n);} else {fail++;console.log('  \u2717',n); if(d)console.log('     ',d);} }

console.log('\n=== SSR \uc19d ===');
t('SSR 에 Shop the Story 섹션이 있다', /seo-shop/.test(ssr) && /Shop the Story/.test(ssr));
t('핸들 가드 유지 (깨진 /go URL 사고 방지)',
  /shopBrands = kind === 'editorial'[\s\S]{0,200}\^\[a-z0-9\._\]\{2,30\}\$/.test(ssr));
t('수수료 고지 문구 (ko/en)', /수수료가 지급될 수 있습니다/.test(ssr) && /earn a commission/.test(ssr));
t('스폰서 링크 규격 (rel=sponsored nofollow)',
  /seo-shop[\s\S]{0,900}rel="sponsored nofollow noopener"/.test(ssr));
/* 2026-08-22 — 다운로드 블록이 에디토리얼 전용이 되면서 사이에 주석 한 덩이가
   들어갔다. 검사할 사실은 '순서'지 '두 줄이 붙어 있느냐'가 아니다. */
t('에디토리얼에서 다운로드 위에 배치 (SPA 원칙과 동일)',
  ssr.indexOf("kind === 'editorial' ? shopHtml") < ssr.indexOf("kind === 'editorial' ? downloadsHtml"));

console.log('--- SPA \uc19d (\uae30\uc874 \uc720\uc9c0) ---');
t('SPA Shop the Story 박스 존재', /Shop the Story/.test(spa));
t('SPA 핸들 가드 유지', /brands=brands\.filter\(function\(c\)\{return \/\^\[a-z0-9\._\]\{2,30\}\$\//.test(spa));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('\u274c ssr-shop-story tests FAILED'); process.exit(1); }
