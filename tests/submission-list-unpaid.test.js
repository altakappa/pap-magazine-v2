/**
 * 결제 미완료 서브미션 리스트 제외 (2026-08-17, 도메니코 지적).
 *
 * 유료 유형(branded 등)인데 페이팔 승인 전(awaiting_authorization /
 * awaiting_payment)인 서브미션이 심사 리스트에 노출됐다. 관리자 GET
 * 리스트 쿼리에 or 필터로 제외한다. NULL(과거 행)은 is.null 로 살린다 —
 * not.in 단독은 NULL 행을 삼키는 PostgREST 특성 회귀 방지.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'submissions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const gets = src.slice(src.indexOf('── GET: List all submissions'));
t('리스트 쿼리에 결제 미완료 제외 필터가 있다',
  /payment_status\.not\.in\.\(awaiting_authorization,awaiting_payment\)/.test(gets));
t('NULL 행 보호 (is.null 을 or 로 함께)',
  /payment_status\.is\.null,payment_status\.not\.in\./.test(gets));
t('필터가 status 분기보다 앞(기본 쿼리)에 걸린다',
  gets.indexOf('payment_status.not.in') < gets.indexOf("status === 'resubmitted'"));
t('POST(생성) 쪽 payment_status 로직은 그대로다',
  /payment_status: feeForType\(submissionType\) \? 'awaiting_authorization' : 'none'/.test(src));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ submission-list-unpaid tests FAILED'); process.exit(1); }
