// PAP Magazine — admin dashboard payment-filter lockstep test
//
// 2026-08-24 (도메니코 지적): 유료 유형(branded)인데 결제 승인을 안 마친
// "Red spot without shadow"(payment_status='awaiting_authorization')가 어드민
// 홈 '최근 서브미션' 위젯에 '대기 중'으로 떴다. 8/17의 결제 필터는 목록
// 엔드포인트(api/submissions/index.js)에만 붙었고, 홈 위젯이 쓰는
// api/admin/stats.js 의 recentSubmissions/pending 카운트 쿼리에는 없었다.
//
// 이 테스트는 두 파일이 **문자열까지 동일한** PostgREST or-필터를 쓰는지 고정한다.
// (문자열이 다르면 NULL 행 처리 등 의미가 갈라질 수 있다 — not.in 단독은 NULL 을
// 삼킨다는 index.js 의 교훈이 stats 쪽에서 조용히 무효화되는 것을 막는다.)
//
// Run with `node tests/admin-stats-payment-filter.test.js` (wired into `npm test`).

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures.push({ label, detail }); failed++; }
}

const statsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'admin', 'stats.js'), 'utf8');
const listSrc = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'submissions', 'index.js'), 'utf8');

// The canonical filter as the list endpoint (8/17 fix) defines it.
const FILTER = 'payment_status.is.null,payment_status.not.in.(awaiting_authorization,awaiting_payment)';

console.log('\n=== 결제 필터 lockstep (stats ↔ submissions list) ===');
ok('목록 엔드포인트(index.js)가 기준 필터 문자열을 그대로 쓴다',
   listSrc.includes(FILTER));
ok('stats.js 가 동일한 필터 문자열을 상수로 갖는다 (PAYMENT_VISIBLE_OR)',
   statsSrc.includes(FILTER) && statsSrc.includes('PAYMENT_VISIBLE_OR'));

// Both submissions queries in stats.js must apply it via .or(...).
const recentQ = statsSrc.match(/from\('submissions'\)\s*\.select\('\*'\)[^\n]*/);
ok('최근 5건 쿼리(recentSubmissions)에 .or(PAYMENT_VISIBLE_OR) 가 걸려 있다',
   !!recentQ && recentQ[0].includes(".or(PAYMENT_VISIBLE_OR)"),
   recentQ && recentQ[0]);
const pendingQ = statsSrc.match(/from\('submissions'\)[^\n]*status',\s*'pending'\)[^\n]*/);
ok("pending 카운트 배지 쿼리에도 .or(PAYMENT_VISIBLE_OR) 가 걸려 있다",
   !!pendingQ && pendingQ[0].includes(".or(PAYMENT_VISIBLE_OR)"),
   pendingQ && pendingQ[0]);

// NULL 행 보존 의미가 필터 문자열 안에 남아 있는지 (과거 행 삼킴 방지).
ok('필터가 payment_status NULL(과거 행)을 살린다 (is.null 이 or 에 포함)',
   FILTER.startsWith('payment_status.is.null,'));

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) {
  console.log('\n⚠  FAILURES:');
  for (const f of failures) console.log(`  - ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
console.log('✓ admin-stats payment-filter tests passed');
process.exit(0);
