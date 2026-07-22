/**
 * 헤더 폴백 검색 제출 핸들러 회귀 (QA 2026-07-22).
 *
 * [근본 원인] SSR 페이지(에디토리얼/아티클/필름 목록·상세)는 legacy
 * #searchBar 가 없어 #papSearchOverlay 폴백이 열리는데, 입력창
 * (#papSearchInput)에 아무 핸들러가 없어 "검색창은 열리지만 입력해도
 * 아무 일도 안 일어나는" 상태였다 (라이브 실측: overlayOpens true,
 * onkeydown null). Enter → /search?q=… 이동으로 전 페이지 플로우 완성.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const hdr = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pap-header.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 헤더 폴백 검색 제출 ===');
t('papSearchInput 에 keydown 핸들러 바인딩 존재',
  /papSearchInput'\);[\s\S]{0,200}addEventListener\('keydown'/.test(hdr),
  '핸들러가 사라지면 SSR 페이지 검색이 다시 먹통이 된다');
t('Enter 시 /search?q= 로 이동', /'\/search\?q=' \+ encodeURIComponent\(q\)/.test(hdr));
t('빈 검색어는 무시', /if \(!q\) return;/.test(hdr));
t('중복 바인딩 가드(_papSearchBound)', /_papSearchBound/.test(hdr));
// 실행 시점: 바인딩은 DOM 주입 후(_afterInject 내부)여야 한다.
const afterInject = (hdr.match(/function _afterInject\(\) \{[\s\S]*$/) || [''])[0];
t('바인딩이 _afterInject(주입 후 실행) 안에 위치', /_papSearchBound/.test(afterInject),
  '주입 전에 실행되면 getElementById 가 null → 조용히 무바인딩');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ header-fallback-search tests FAILED'); process.exit(1); }
console.log('✅ header-fallback-search tests passed');
