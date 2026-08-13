/**
 * 2026-08-13 — Paddle 폐쇄(8/14) 이후 '구독 해지' 가 거짓말을 하지 않는다.
 *
 * ■ 왜 필요한가 (실측)
 *   활성 구독 5명 중 4명이 아직 Paddle 이다:
 *     ZA 9/30 · FR 10/7 · DE 10/7 · VN 10/8 — 전부 폐쇄일보다 뒤다.
 *   8/14 이후 이 4명이 마이페이지에서 '구독 해지'를 누르면 paddle-portal 이
 *   Paddle API 를 부르고 실패한다 → 프론트는 fail 문구를 띄운다:
 *     "해지 처리에 실패했습니다. contact@pap-magazine.com 으로 연락 주세요"
 *
 *   사실과 정반대다. 청구 주체가 사라져 **이미 갱신이 불가능하다.**
 *   해지할 필요가 없는데 실패했다고 말하면, 그 사람은 돈이 계속 나간다고 믿고
 *   카드사·PayPal 분쟁을 건다. Paddle 을 막 잃은 지금 결제 계정을 하나 더 잃는
 *   길이다. 독일 § 312k BGB(해지 기능의 실효성)와 우리 약관(refund.html 제2조)
 *   관점에서도 '해지 실패' 로 끝나면 안 된다.
 *
 * ■ 이 테스트가 고정하는 것
 *   1. 폐쇄 판정이 **한 곳에만** 있다 (날짜를 두 군데 박으면 한쪽만 고치는 사고가 난다)
 *   2. 폐쇄 뒤에는 Paddle 을 부르기 전에 빠져나간다
 *   3. 200 + effective_at 을 돌려준다 → 프론트가 이미 가진 9개 언어 문구가 그대로 뜬다
 *   4. 이미 낸 기간(current_period_end)은 건드리지 않는다
 *   5. 기간 종료 후 등급을 내리는 짝(만료 스윕)이 'canceled' 를 훑는다
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 주석을 걷어낸 '실제 코드' — 주석 속 언급이 통과로 잡히면 안 된다. */
const codeOf = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

const lib = read('api/_lib/cancelProviderSubscription.js');
const portal = read('api/subscriptions/paddle-portal.js');
const libCode = codeOf(lib);
const portalCode = codeOf(portal);

console.log('=== 1. 폐쇄 판정은 한 곳에만 산다 ===');
{
  ok('cancelProviderSubscription 이 paddleIsGone 을 내보낸다',
    /module\.exports\s*=\s*\{[^}]*paddleIsGone/.test(libCode));
  ok('paddle-portal 이 그것을 가져다 쓴다',
    /require\('\.\.\/_lib\/cancelProviderSubscription'\)/.test(portalCode)
    && /paddleIsGone/.test(portalCode));
  ok('폐쇄 날짜가 저장소에 한 번만 박혀 있다',
    (libCode.match(/Date\.UTC\(2026,\s*7,\s*14/g) || []).length === 1
    && !/Date\.UTC\(2026,\s*7,\s*14/.test(portalCode),
    '두 군데 박으면 한쪽만 고치는 사고가 난다 — 이 저장소에서 이미 겪은 패턴');
}

console.log('=== 2. 폐쇄 뒤에는 Paddle 을 부르지 않는다 ===');
{
  const gateAt = portalCode.indexOf('paddleIsGone()');
  const fetchAt = portalCode.indexOf('PADDLE_API_BASE}/subscriptions/');
  ok('폐쇄 분기가 있다', gateAt > -1);
  ok('Paddle 해지 호출이 있다', fetchAt > -1);
  ok('폐쇄 분기가 Paddle 호출보다 앞에 있다', gateAt > -1 && fetchAt > -1 && gateAt < fetchAt,
    '뒤에 있으면 이미 실패한 뒤라 의미가 없다');
  ok('폐쇄 분기 안에서 응답을 끝낸다 (return)',
    /if \(paddleIsGone\(\)\) \{[\s\S]{0,1200}?return res\.status\(200\)/.test(portalCode));
}

console.log('=== 3. 키가 없어도 폐쇄 처리는 된다 ===');
{
  const keyGuard = portalCode.indexOf("message: 'International payment not yet configured.'");
  const gateAt = portalCode.indexOf('paddleIsGone()');
  ok('PADDLE_API_KEY 가드가 폐쇄 분기보다 뒤에 있다', keyGuard > -1 && gateAt > -1 && gateAt < keyGuard,
    '폐쇄 후 키를 지우면 503 이 먼저 나가 분기 자체가 죽는다');
}

console.log('=== 4. 사용자에게 사실대로 말한다 ===');
{
  ok('200 으로 성공을 돌려준다', /return res\.status\(200\)\.json\(\{[\s\S]{0,300}shutdown: true/.test(portalCode));
  ok('effective_at 을 같이 준다 (프론트가 "{d} 까지 이용" 을 띄운다)',
    /effective_at: row\.current_period_end/.test(portalCode),
    '없으면 날짜 없는 맹탕 안내가 된다');
  ok('DB 를 canceled 로 내린다', /status: 'canceled'/.test(portalCode));
  ok('이미 낸 기간을 건드리지 않는다',
    !/update\(\{[^}]*current_period_end/.test(portalCode),
    '기간을 줄이면 이미 받은 돈에 대한 서비스를 뺏는 것이다');
  ok('텔레그램을 await 한다 (서버리스는 응답 후 함수를 얼린다)',
    /await sendTextToTelegramSafe\(/.test(portalCode));
}

console.log('=== 5. 기간이 끝난 뒤 등급을 내리는 짝이 살아 있다 ===');
{
  const sweep = codeOf(read('api/cron/subscription-expiry-sweep.js'));
  ok("만료 스윕이 'canceled' 도 훑는다",
    /\.in\('status', \[[^\]]*'canceled'[^\]]*\]\)/.test(sweep),
    "빠지면 해지자가 영원히 유료 등급으로 남는다 — 이 경로가 바로 그 해지자를 만든다");
  ok('만료 스윕이 자동강등 스위치를 갖고 있다',
    /SUBSCRIPTION_EXPIRY_AUTODOWNGRADE/.test(sweep));
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ paddle-portal-shutdown tests passed');
process.exit(0);
