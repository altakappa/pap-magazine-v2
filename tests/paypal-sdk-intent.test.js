/**
 * 2026-08-13 — PayPal SDK 의 intent 는 주문의 intent 와 반드시 같아야 한다.
 *
 * ■ 어떻게 발견했나
 *   프리뷰(샌드박스)에서 승인후결제 A판(거절 경로)을 실측하려고 브랜디드 서브미션을
 *   제출했다. 결제창이 뜨자마자 "결제창을 여는 중 문제가 발생했습니다" 로 죽었다.
 *   콘솔:
 *     Expected intent from order api call to be capture, got authorize.
 *     Please ensure you are passing intent=authorize to the sdk url.
 *
 *   서버(api/submissions/paypal-order.js)는 심사 전 게재료 주문을 AUTHORIZE 로
 *   만드는데, 브라우저는 SDK 를 intent=capture 로 띄우고 있었다. PayPal 이 그
 *   불일치를 거부한다. 결과적으로 €790·€380 결제창이 실서비스에서 한 번도
 *   열리지 않았다.
 *
 * ■ 왜 테스트가 못 잡았나
 *   승인후결제 단위 테스트 74개는 전부 서버 쪽이다. SDK URL 은 브라우저에서만
 *   평가되고, 거부 판정은 PayPal 서버에서 일어난다. node 로는 영원히 재현되지
 *   않는다 — 2026-08-12 텔레그램 await 누락과 정확히 같은 계열이다.
 *
 * ■ 이 테스트가 하는 일
 *   런타임이 아니라 **소스를 직접 읽어** 세 가지를 고정한다:
 *     1. SDK URL 의 intent 가 하드코딩돼 있지 않다 (변수로 들어간다)
 *     2. 호출부가 opts.mode 로 intent 를 정해서 로더에 넘긴다
 *     3. window.paypal.Buttons 를 직접 쓰지 않는다
 *        (네임스페이스를 나눈 뒤에는 window.paypal 이 undefined 다 —
 *         이걸 안 바꾸면 이번엔 다른 이유로 또 깨진다)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FEE = path.join(ROOT, 'frontend/pap-submission-fee.js');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

const src = fs.readFileSync(FEE, 'utf8');
// 주석은 검사 대상이 아니다 — 사고 경위를 주석에 적어두면 오탐이 난다.
const code = src
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

console.log('=== SDK URL 의 intent 가 하드코딩돼 있지 않다 ===');
{
  ok('intent=capture 가 코드에 박혀 있지 않다',
    !/intent=capture/.test(code),
    'AUTHORIZE 주문을 capture SDK 로 띄우면 PayPal 이 거부한다');
  ok('intent=authorize 도 박혀 있지 않다',
    !/intent=authorize/.test(code),
    '반대 방향으로 박아도 애드온(capture)이 죽는다');
  ok('intent 를 변수로 이어붙인다',
    /'&currency=EUR&intent='\s*\+\s*intent/.test(code));
}

console.log('=== 로더가 intent 를 인자로 받고 네임스페이스를 나눈다 ===');
{
  ok('_loadPayPalSdkOnce(clientId, intent) 시그니처다',
    /function\s+_loadPayPalSdkOnce\s*\(\s*clientId\s*,\s*intent\s*\)/.test(code));
  ok('data-namespace 를 붙인다',
    /setAttribute\(\s*'data-namespace'\s*,/.test(code),
    '없으면 두 번째 SDK 로딩이 첫 번째를 덮어써서 먼저 뜬 쪽이 조용히 망가진다');
  ok('네임스페이스 객체를 resolve 한다',
    /resolve\(\s*window\[ns\]\s*\)/.test(code));
}

console.log('=== 호출부가 모드에 맞는 intent 로 로딩한다 ===');
{
  ok("opts.mode === 'authorize' 로 모드를 정한다",
    /_isAuth\s*=\s*\(\s*opts\.mode\s*===\s*'authorize'\s*\)/.test(code));
  ok('그 값을 로더에 넘긴다',
    /_loadPayPalSdkOnce\(\s*cfg\.clientId\s*,\s*_isAuth\s*\?\s*'authorize'\s*:\s*'capture'\s*\)/.test(code));
  ok('로더 호출 결과를 받아서 쓴다',
    /var\s+_pp\s*=\s*await\s+_loadPayPalSdkOnce/.test(code));
}

console.log('=== window.paypal 을 직접 쓰지 않는다 ===');
{
  ok('window.paypal.Buttons 직접 호출이 0건이다',
    !/window\.paypal\.Buttons/.test(code),
    '네임스페이스를 나누면 window.paypal 은 undefined 다');
  ok('네임스페이스 객체로 Buttons 를 만든다',
    /_pp\.Buttons\(/.test(code));
}

console.log('=== 서버의 주문 intent 분기가 그대로 살아 있다 ===');
{
  const ORDER = path.join(ROOT, 'api/submissions/paypal-order.js');
  const o = fs.readFileSync(ORDER, 'utf8');
  ok('심사 전 게재료는 AUTHORIZE 다',
    /kind === 'submission_fee'[\s\S]{0,120}!==\s*'approved'[\s\S]{0,80}'AUTHORIZE'/.test(o),
    '이 분기가 사라지면 프론트의 authorize 모드가 갈 곳을 잃는다');
}

console.log('=== 캐시버스트가 올라가 있다 ===');
{
  // JS 를 고치고 ?v= 를 안 올리면 브라우저가 옛 파일을 계속 쓴다 — 저장소 관례.
  for (const rel of ['frontend/submission.html', 'frontend/mypage.html']) {
    const h = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = h.match(/pap-submission-fee\.js\?v=(\d+)/);
    ok(rel + ' 의 pap-submission-fee.js 버전이 7 이상이다',
      !!m && parseInt(m[1], 10) >= 7,
      m ? ('현재 v' + m[1]) : '태그를 못 찾음');
  }
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ paypal-sdk-intent tests passed');
process.exit(0);
