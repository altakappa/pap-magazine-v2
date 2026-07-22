/**
 * 서브미션 약관 조항 좌측 정렬 (2026-07-22 QA: 재점검 미해결).
 *
 * [원인] .content 에 text-align:center 가 걸려 있고(폼 전체 중앙정렬), 바로 아래
 * '좌측정렬 예외' 규칙 목록에 약관 요소(.terms-box/.terms-title)가 빠져 있었다.
 * text-align 은 상속 속성이라, 약관 조항 제목·본문이 .content 의 center 를 그대로
 * 물려받아 중앙정렬로 보였다. (라이브 computed 실측: before center → 규칙 주입 후 left)
 *
 * [수정] .content .terms-* 선택자로 좌측정렬을 명시(.content{center} 보다 우선).
 * 이 테스트는 그 규칙이 존재하고 다시 빠지지 않도록 감시한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'submission.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 서브미션 약관 좌측 정렬 (재발 방지) ===');

// 좌측정렬 규칙에 약관 박스와 제목이 포함돼 있는가
const leftRule = (html.match(/\.content \.terms-title[^\n{]*\{text-align:left\}/) || [''])[0];
t('약관 좌측정렬 규칙이 존재한다', leftRule.length > 0);
t('규칙에 .terms-box 포함', /\.content \.terms-box\b/.test(leftRule));
t('규칙에 .terms-box li 포함 (본문 조항)', /\.content \.terms-box li\b/.test(leftRule));
t('규칙에 .terms-title 포함 (조항 제목)', /\.content \.terms-title\b/.test(leftRule));
t('좌측정렬로 지정', /\{text-align:left\}/.test(leftRule));

// .content 자체는 여전히 center (레이아웃 유지) — 약관만 예외로 좌측
t('.content 는 그대로 center 유지 (레이아웃 회귀 아님)', /\.content\{[^}]*text-align:center/.test(html));

// 효력발생일 줄도 좌측 (약관 박스 전체 좌측 정렬 일관성)
t('효력발생일(termsEffective) 줄이 center 로 남아있지 않다',
  !/text-align:center"[^>]*data-i18n="termsEffective"/.test(html),
  '효력발생일이 center 면 약관 박스 안에서 홀로 가운데로 떠 보인다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-terms-align tests FAILED'); process.exit(1); }
console.log('✅ submission-terms-align tests passed');
