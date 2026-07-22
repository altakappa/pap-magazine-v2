/**
 * Footer 중앙 정렬 회귀 (QA 2026-07-22).
 *
 * [근본 원인] pap-header.js 주입 CSS
 *   `.pap-has-header:not(.pap-keep-side-nav) .footer-legal{margin-left:0!important}`
 * 가 subscribe·submission·pullletter 의 `.footer-legal{margin:0 auto}` 좌측 auto 를
 * 죽여 푸터가 왼쪽에 붙었다 (라이브 실측: computed margin 0px/400px @1200px 뷰포트).
 * 수정: margin-left/right 모두 auto!important — 옛 side-nav 고정 여백 상쇄(원래 의도)와
 * 중앙 정렬을 동시에 만족. side-nav 페이지(about/business/contact)는 :not() 으로 제외되어
 * 설계값 margin-left:120px 유지.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const hdr = R('frontend/pap-header.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 헤더 주입 CSS ===');
t('margin-left:0!important 강제 규칙 제거됨 (중앙 정렬 킬러)',
  !/\.footer-legal\{margin-left:0!important\}/.test(hdr),
  '이 규칙이 돌아오면 margin:0 auto 페이지의 푸터가 다시 왼쪽에 붙는다');
t('비 side-nav 푸터는 auto 마진 (상쇄+중앙 동시 충족)',
  /\.pap-has-header:not\(\.pap-keep-side-nav\) \.footer-legal\{margin-left:auto!important;margin-right:auto!important\}/.test(hdr));
t('side-nav 페이지는 :not() 으로 계속 제외', /:not\(\.pap-keep-side-nav\) \.footer-legal/.test(hdr));

console.log('--- 세 페이지의 중앙 정렬 설계 유지 ---');
[['frontend/subscribe.html', 1200], ['frontend/submission.html', 900], ['frontend/pullletter.html', 800]].forEach(function(p){
  const html = R(p[0]);
  t(p[0] + ' — .footer-legal{max-width:' + p[1] + 'px;margin:0 auto}',
    new RegExp('\\.footer-legal\\{\\s*max-width:' + p[1] + 'px;margin:0 auto').test(html));
});

console.log('--- side-nav 페이지 설계값 보존 ---');
['frontend/about.html', 'frontend/business.html', 'frontend/contact.html'].forEach(function(f){
  const html = R(f);
  t(f + ' — margin-left:120px 유지 + pap-keep-side-nav',
    /\.footer-legal\{margin-left:120px/.test(html) && /pap-keep-side-nav/.test(html));
});

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ footer-center tests FAILED'); process.exit(1); }
console.log('✅ footer-center tests passed');
