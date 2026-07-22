/**
 * MORE CONTENT 캐러셀 스크롤 가능성 회귀 (QA 2026-07-22).
 *
 * [근본 원인] .ed-more-card{flex:1 1 0;min-width:0} — 카드가 개수만큼
 * 수축해 트랙이 절대 넘치지 않는다 (라이브 실측: 8장인데 scrollWidth
 * 836 == clientWidth 836, 카드폭 96px). 좌우 버튼(scrollBy)은 정상인데
 * 움직일 거리가 0 이라 "무반응"으로 보였다.
 * [수정] 데스크톱 4장 고정 폭 flex:0 0 calc((100% - 30px)/4) — 5장째부터
 * 넘쳐 스크롤 가능. v5 모바일(768)은 2장. pap-styles 모바일 오버라이드
 * (flex:0 0 auto + 고정 min/max-width)는 기존대로 유지.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const v5  = R('frontend/pap-magazine-v5.html');
const css = R('frontend/pap-styles.css');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== MORE CONTENT 캐러셀 ===');
t('v5: 수축형 flex:1 1 0 카드 규칙 제거됨',
  !/\.ed-more-card\{flex:1 1 0/.test(v5),
  '수축형이 돌아오면 트랙이 넘치지 않아 좌우 버튼이 다시 무반응');
t('v5: 데스크톱 4장 고정 폭', /\.ed-more-card\{flex:0 0 calc\(\(100% - 30px\)\/4\)/.test(v5));
t('v5: 모바일(768) 2장 고정 폭', /\.ed-more-card\{flex:0 0 calc\(\(100% - 10px\)\/2\)/.test(v5));
t('pap-styles: 수축형 기본 규칙 제거됨', !/\.ed-more-card\{flex:1 1 0/.test(css));
t('pap-styles: 데스크톱 4장 고정 폭', /\.ed-more-card\{flex:0 0 calc\(\(100% - 30px\)\/4\)/.test(css));
t('pap-styles: 모바일 고정폭 오버라이드 유지(flex:0 0 auto)', /\.ed-more-card\{flex:0 0 auto;min-width:180px/.test(css));
t('트랙 overflow-x:auto 유지 (스크롤 컨테이너)', /\.ed-more-track\{display:flex;gap:10px;overflow-x:auto/.test(css) && /\.ed-more-track\{display:flex;gap:10px;overflow-x:auto/.test(v5));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ more-content-carousel tests FAILED'); process.exit(1); }
console.log('✅ more-content-carousel tests passed');
