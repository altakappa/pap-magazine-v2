/**
 * 서브미션 결제 금액 산출 — 실제로 모듈을 로드해서 호출한다 (2026-08-11).
 *
 * [왜 있는가 — 실측으로 터진 사고]
 * api/_lib/submissionPayment.js 의 module.exports 에 storedSubmissionType 이
 * 빠져 있었다. paypalOrders.js 는 그 이름으로 구조분해 import 했고 값은
 * undefined 였다. 그래서 resolveAmount() 가 호출되는 순간 TypeError 가 나고
 * paypal-order.js 의 catch 가 500 "Could not start payment." 를 돌려줬다.
 *
 *   → €380 / €790 기본 게재료 결제가 100% 실패했다.
 *   → 애드온(€110/€220)은 그 함수를 안 써서 멀쩡했다. 그래서 눈에 안 띄었다.
 *   → 실제 고객 3명(pap_korea·muhammadyunus38·juan.santamariaph)이
 *     8번 시도해서 전부 실패한 것과 같은 계열의 사고다.
 *
 * [왜 기존 테스트가 못 잡았나]
 * 우리 테스트는 대부분 파일을 문자열로 읽어 정규식으로 검사한다.
 * 그러면 "import 한 이름이 실제로 export 되어 있는가" 는 절대 안 보인다.
 * 이 파일은 **실제로 require 해서 실제로 호출한다.** 그게 요점이다.
 */
'use strict';
const path = require('path');
const p = (...a) => path.join(__dirname, '..', ...a);

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 1. 모듈이 실제로 로드되고 함수가 실재한다 ===');
const sp = require(p('api','_lib','submissionPayment.js'));
t('submissionPayment 가 storedSubmissionType 을 export 한다',
  typeof sp.storedSubmissionType === 'function',
  '이게 없으면 €380/€790 결제가 전부 500 이 된다');
t('submissionPayment 가 feeForType 을 export 한다', typeof sp.feeForType === 'function');

const po = require(p('api','_lib','paypalOrders.js'));
t('paypalOrders 가 resolveAmount 를 export 한다', typeof po.resolveAmount === 'function');
t('paypalOrders 가 centsToValue 를 export 한다', typeof po.centsToValue === 'function');

console.log('\n=== 2. 기본 게재료 — 실제 호출해서 금액을 확인한다 ===');
const mk = (type) => ({ description: JSON.stringify({ submissionType: type }) });
const cases = [
  ['branded',        79000, '€790'],
  ['paid_few_looks', 38000, '€380'],
  ['few_looks',      38000, '€380'],
  ['Branded',        79000, '대소문자 무관'],
  ['paid-few-looks', 38000, '하이픈 표기'],
];
for (const [type, cents, label] of cases) {
  let r; try { r = po.resolveAmount(mk(type), 'submission_fee'); } catch (e) { r = { throwErr: e.message }; }
  t(`${type} → ${cents} (${label})`, r && r.cents === cents, JSON.stringify(r));
}

console.log('\n=== 3. 애드온 ===');
const addons = [['ig_collab', 11000], ['ig_images_cover', 22000], ['posting_date', 11000]];
for (const [k, cents] of addons) {
  let r; try { r = po.resolveAmount({}, 'submission_addon', k); } catch (e) { r = { throwErr: e.message }; }
  t(`${k} → ${cents}`, r && r.cents === cents, JSON.stringify(r));
}
t('없는 애드온은 error 를 준다 (throw 아님)',
  (() => { try { return po.resolveAmount({}, 'submission_addon', 'nope').error === 'unknown_addon'; }
           catch (_) { return false; } })());

console.log('\n=== 4. 무료 서브미션은 결제 대상이 아니다 ===');
for (const type of ['free', 'editorial', null, undefined, '']) {
  let r; try { r = po.resolveAmount(mk(type), 'submission_fee'); } catch (e) { r = { throwErr: e.message }; }
  t(`${String(type)} → not_a_paid_submission`, r && r.error === 'not_a_paid_submission', JSON.stringify(r));
}
t('description 이 깨진 JSON 이어도 던지지 않는다',
  (() => { try { return po.resolveAmount({ description: '{{{' }, 'submission_fee').error === 'not_a_paid_submission'; }
           catch (_) { return false; } })());

console.log('\n=== 5. PayPal 에 보내는 문자열 형식 ===');
t('79000 → "790.00"', po.centsToValue(79000) === '790.00');
t('38000 → "380.00"', po.centsToValue(38000) === '380.00');
t('11000 → "110.00"', po.centsToValue(11000) === '110.00');

console.log('\n=== 6. 금액은 서버만 정한다 ===');
const orderSrc = require('fs').readFileSync(p('api','submissions','paypal-order.js'), 'utf8');
t('클라이언트 body 에서 금액을 읽지 않는다',
  !/body\.(amount|price|cents|value|total)/i.test(orderSrc),
  '2026-07-20 감사에서 막은 구멍 — 다시 열리면 안 된다');
t('금액은 resolveAmount 결과만 쓴다', /value:\s*centsToValue\(amt\.cents\)/.test(orderSrc));
t('소유자 확인이 있다', /Not your submission/.test(orderSrc));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ paypal-order-pricing tests FAILED'); process.exit(1); }
console.log('✅ paypal-order-pricing tests passed');
