/**
 * 발행호 자동 산출 (2026-07-21 폼 개편). 커버 에디토리얼 하나로
 * 발행연도·분기 시작월·기간라벨·커버이미지가 자동 결정되는지 검증.
 */
'use strict';
const { quarterStartMonth, quarterLabel, deriveFromCoverEditorial } = require('../api/_lib/magazineIssueDerive');
let pass=0, fail=0;
function t(n,c,d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 발행호 자동 산출 ===');
t('분기 시작월: 2→1,5→4,8→7,11→10', quarterStartMonth(2)===1&&quarterStartMonth(5)===4&&quarterStartMonth(8)===7&&quarterStartMonth(11)===10);
t('분기 시작월 경계: 1→1,3→1,4→4,12→10', quarterStartMonth(1)===1&&quarterStartMonth(3)===1&&quarterStartMonth(4)===4&&quarterStartMonth(12)===10);
t('기간라벨 Q3', quarterLabel(2026,7)==='JUL–SEP 2026');
t('기간라벨 Q1', quarterLabel(2026,2)==='JAN–MAR 2026');
t('기간라벨 Q4 전년', quarterLabel(2025,11)==='OCT–DEC 2025');
const d1=deriveFromCoverEditorial({published_date:'2026-08-15',cover_image:'c.jpg'});
t('커버 에디토리얼→자동', d1.issue_year===2026&&d1.issue_month===7&&d1.month_label==='JUL–SEP 2026'&&d1.cover_image==='c.jpg');
const d2=deriveFromCoverEditorial({published_date:'2026-01-03',thumbnail:'t.jpg'});
t('커버 이미지 폴백(thumbnail)', d2.cover_image==='t.jpg'&&d2.issue_month===1);
const d3=deriveFromCoverEditorial({published_date:'2026-05-01',gallery:['g0.jpg','g1.jpg']});
t('커버 이미지 폴백(gallery[0])', d3.cover_image==='g0.jpg'&&d3.issue_month===4);
const d4=deriveFromCoverEditorial({cover_image:'x.jpg'});
t('발행일 없으면 연/월 null(이미지는 유지)', d4.issue_year===null&&d4.issue_month===null&&d4.cover_image==='x.jpg');
t('null 방어', deriveFromCoverEditorial(null).cover_image==='');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ magazine-issue-derive tests FAILED'); process.exit(1); }
console.log('✅ magazine-issue-derive tests passed');
