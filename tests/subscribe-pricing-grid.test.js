/**
 * 구독 상품 3열 가로 배치 회귀 (2026-07-22 도메니코 지시).
 *
 * [원인] @media(max-width:1024px) 가 .pricing-grid 를 1열로 전환 →
 * ~900px 브라우저 창에서 세 상품이 세로로 나열됐다.
 * [수정] 1024px 이하에서도 3열 유지(간격만 축소), 1열 스택은 768px
 * 미만(모바일)에서만.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'subscribe.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 구독 상품 3열 가로 배치 ===');
t('기본: .pricing-grid 3열 (repeat(3,1fr))',
  /\.pricing-grid\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(html));

const mq1024 = (html.match(/@media\(max-width:1024px\)\{[\s\S]*?\n\}/) || [''])[0];
t('1024px 이하: 1열 전환 규칙 제거됨 (가로 유지)',
  mq1024 !== '' && !/\.pricing-grid\{[^}]*grid-template-columns:1fr/.test(mq1024),
  '이 규칙이 돌아오면 ~900px 창에서 다시 세로 나열');
t('1024px 이하: 간격 축소로 3열 수용', /\.pricing-grid\{gap:12px\}/.test(mq1024));

const mq768 = (html.match(/@media\(max-width:768px\)\{[\s\S]*?\n\}/) || [''])[0];
t('768px 미만(모바일): 1열 스택 유지', /\.pricing-grid\{grid-template-columns:1fr/.test(mq768),
  '모바일에서 3열은 카드가 읽을 수 없게 좁아진다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ subscribe-pricing-grid tests FAILED'); process.exit(1); }
console.log('✅ subscribe-pricing-grid tests passed');
