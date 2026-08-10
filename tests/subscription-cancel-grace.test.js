/**
 * 해지해도 "이미 결제한 기간"까지는 접근권을 유지해야 한다 (2026-08-10 라이브 실측).
 *
 * [무엇이 잘못됐었나]
 * 해지 웹훅이 profiles.subscription_status 를 그 자리에서 'inactive' 로 내렸다.
 * 9/10 까지 결제된 구독을 해지하자 그 순간 등급 게이트가 막혔다.
 *
 * [왜 중대한가] 우리는 세 곳에서 정반대를 약속했다:
 *   · frontend/refund.html — "해지 후에도 해당 결제 기간이 종료될 때까지 이용 가능"
 *   · 마이페이지 해지 확인창/완료창
 *   · api/subscriptions/paypal-portal.js 주석
 * 약관이 약속한 것을 코드가 어기면 환불 요구와 지급거절(chargeback)로 돌아온다.
 * 2026-08-07 lia.line 사고(중복 해지가 멀쩡한 접근권을 끊음)와 뿌리가 같다.
 *
 * 이 테스트는 그 동작이 되돌아가지 않도록 소스 수준에서 못을 박는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const hook  = fs.readFileSync(path.join(__dirname, '..', 'api', 'paypal-webhook.js'), 'utf8');
const sweep = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'subscription-expiry-sweep.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 해지 유예: 결제한 기간까지 접근권 유지 ===');

// handleTermination 본문만 떼어 검사
const fn = (hook.match(/async function handleTermination[\s\S]*?\n\}/) || [''])[0];

t('handleTermination 존재', /async function handleTermination/.test(hook));
t('구독 기간 끝(current_period_end)을 조회한다',
  /current_period_end/.test(fn),
  '기간을 모르면 유예 판정 자체가 불가능하다');
t('결제한 기간이 남았는지 판정한다',
  /stillWithinPaidPeriod/.test(fn));
t('기간이 남았으면 강등하지 않고 반환한다',
  /if\s*\(\s*stillWithinPaidPeriod\s*\)[\s\S]{0,400}?return/.test(fn),
  '조기 반환이 없으면 아래 강등 코드까지 흘러간다');
t('EXPIRED 는 예외로 즉시 강등한다',
  /BILLING\.SUBSCRIPTION\.EXPIRED/.test(fn),
  '만료는 기간이 끝났다는 뜻이므로 유예 대상이 아니다');

// 강등이 유예 판정 뒤에 오는지 (순서가 뒤집히면 유예가 무의미)
const idxGuard = fn.indexOf('stillWithinPaidPeriod');
const idxDown  = fn.indexOf("subscription_status: 'inactive'");
t('강등 코드가 유예 판정보다 뒤에 있다',
  idxGuard !== -1 && idxDown !== -1 && idxGuard < idxDown,
  'guard=' + idxGuard + ' downgrade=' + idxDown);

console.log('\n=== 만료 스윕이 해지 건을 걷어간다 ===');
const inClause = (sweep.match(/\.in\('status',\s*\[[^\]]*\]\)/) || [''])[0];
t('스윕 status 필터에 canceled 포함',
  /'canceled'/.test(inClause),
  "빠져 있으면 해지자가 기간이 지나도 영원히 유료 등급으로 남는다: " + inClause);
t('스윕이 current_period_end 로 자른다', /current_period_end/.test(sweep));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ subscription-cancel-grace tests FAILED'); process.exit(1); }
console.log('✅ subscription-cancel-grace tests passed');
