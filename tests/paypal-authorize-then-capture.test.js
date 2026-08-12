/**
 * 2026-08-12 — 승인후결제(authorize → capture / void) 불변식을 고정한다.
 *
 * ■ 무엇을 지키나
 *   1) SLA(2일) 는 Honor Period(3일) 보다 반드시 짧다.
 *      짧지 않으면 승인이 만료돼 캡처가 실패하고, 재승인 로직이 필요해진다.
 *      지금 재승인 코드는 **의도적으로 없다** — 그래서 이 불변식이 안전장치다.
 *   2) 돈이 빠지는 곳은 capture 하나뿐이다. authorize/void 는 금액을 옮기지 않는다.
 *   3) 이미 끝난 승인(캡처됨/보이드됨/없음)에 대한 보이드는 실패가 아니라 멱등이다.
 *      심사 저장이 두 번 눌려도 사고가 나면 안 된다.
 */

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

// PayPal 호출을 전부 가로챈다 — 실제 네트워크로 나가면 안 된다.
const ordersPath = require.resolve(path.join(ROOT, 'api/_lib/paypalOrders.js'));
const calls = [];
let nextResponse = { ok: true, status: 200, body: {} };
require.cache[ordersPath] = {
  id: ordersPath, filename: ordersPath, loaded: true,
  exports: {
    centsToValue: (c) => (Number(c) / 100).toFixed(2),
    paypalFetch: (p, o) => { calls.push({ path: p, opts: o }); return Promise.resolve(nextResponse); },
  },
};

const A = require(path.join(ROOT, 'api/_lib/paypalAuthorizations.js'));

(async () => {
  console.log('=== 불변식: SLA < Honor Period ===');
  ok('SLA(48h) 가 Honor Period(72h) 보다 짧다', A.REVIEW_SLA_HOURS < A.HONOR_PERIOD_HOURS,
    'SLA=' + A.REVIEW_SLA_HOURS + 'h · Honor=' + A.HONOR_PERIOD_HOURS + 'h — 뒤집히면 승인이 만료된다');
  ok('  → 여유가 최소 12시간 이상이다', A.HONOR_PERIOD_HOURS - A.REVIEW_SLA_HOURS >= 12,
    '크론 지연·시차를 흡수할 여유가 필요하다');

  console.log('=== 기한 계산 ===');
  {
    const t0 = '2026-08-12T00:00:00.000Z';
    ok('Honor 만료 = 승인 +72h', A.honorExpiryFrom(t0) === '2026-08-15T00:00:00.000Z', A.honorExpiryFrom(t0));
    ok('SLA 마감 = 승인 +48h', A.slaDeadlineFrom(t0) === '2026-08-14T00:00:00.000Z', A.slaDeadlineFrom(t0));
    ok('47시간 경과는 아직 SLA 안', A.isPastSla(t0, Date.parse('2026-08-13T23:00:00Z')) === false);
    ok('49시간 경과는 SLA 초과', A.isPastSla(t0, Date.parse('2026-08-14T01:00:00Z')) === true);
    ok('  → SLA 초과 시점에도 Honor 는 아직 살아 있다 (보이드 가능)',
      Date.parse(A.slaDeadlineFrom(t0)) < Date.parse(A.honorExpiryFrom(t0)));
  }

  console.log('=== authorize — 돈을 옮기지 않는다 ===');
  {
    calls.length = 0;
    nextResponse = { ok: true, status: 201, body: {
      purchase_units: [{ payments: { authorizations: [{ id: 'AUTH1', status: 'CREATED',
        amount: { currency_code: 'EUR', value: '790.00' }, expiration_time: '2026-08-15T00:00:00Z' }] } }],
    } };
    const r = await A.authorizeOrder('ORDER1');
    ok('authorization id 를 뽑아낸다', r.ok === true && r.authorizationId === 'AUTH1');
    ok('  → /authorize 를 부른다', calls[0].path === '/v2/checkout/orders/ORDER1/authorize');
    ok('  → capture 를 부르지 않는다', !calls.some((c) => /capture/.test(c.path)),
      'authorize 단계에서 돈이 빠지면 설계가 무너진다');
  }
  {
    nextResponse = { ok: true, status: 201, body: { purchase_units: [{}] } };
    const r = await A.authorizeOrder('ORDER2');
    ok('authorization id 가 없으면 실패로 본다', r.ok === false && r.reason === 'no_authorization_id',
      '조용히 성공 처리하면 승인 없이 심사에 올라간다');
  }

  console.log('=== capture — 서버 산출가로만 청구한다 ===');
  {
    calls.length = 0;
    nextResponse = { ok: true, status: 201, body: { id: 'CAP1', status: 'COMPLETED' } };
    const r = await A.captureAuthorization('AUTH1', 79000, 'pap-cap-SUB1');
    ok('캡처 성공을 반환한다', r.ok === true && r.captureId === 'CAP1');
    const sent = JSON.parse(calls[0].opts.body);
    ok('  → 금액을 유로로 정확히 실어 보낸다', sent.amount.value === '790.00' && sent.amount.currency_code === 'EUR');
    ok('  → final_capture 로 부분캡처 여지를 남기지 않는다', sent.final_capture === true);
    ok('  → 멱등키를 보낸다', calls[0].opts.headers['PayPal-Request-Id'] === 'pap-cap-SUB1',
      '심사 저장이 두 번 눌려도 두 번 청구되면 안 된다');
  }

  console.log('=== void — 거절/SLA초과는 청구 없이 끝난다 ===');
  {
    calls.length = 0;
    nextResponse = { ok: true, status: 204, body: {} };
    const r = await A.voidAuthorization('AUTH1');
    ok('보이드 성공', r.ok === true);
    ok('  → /void 를 부른다', calls[0].path === '/v2/payments/authorizations/AUTH1/void');
    ok('  → 금액을 보내지 않는다 (푸는 것이지 옮기는 게 아니다)', !calls[0].opts.body || calls[0].opts.body === '{}');
  }

  console.log('=== 멱등: 이미 끝난 승인 ===');
  {
    for (const issue of ['AUTHORIZATION_ALREADY_CAPTURED', 'PREVIOUSLY_VOIDED', 'RESOURCE_NOT_FOUND']) {
      nextResponse = { ok: false, status: 422, body: { details: [{ issue }] } };
      const r = await A.voidAuthorization('AUTHX');
      ok(issue + ' 는 멱등으로 판정된다', r.ok === false && A.isAlreadySettled(r.code) === true,
        '재시도로 사고가 나면 안 된다');
    }
    nextResponse = { ok: false, status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } };
    const r = await A.voidAuthorization('AUTHY');
    ok('진짜 오류는 멱등으로 삼키지 않는다', A.isAlreadySettled(r.code) === false,
      '삼키면 묶인 돈을 못 푼 채 끝난다');
  }

  console.log('\n=== SUMMARY ===');
  if (fails.length) {
    console.error('passed: ' + pass + '   failed: ' + fails.length);
    fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
    process.exit(1);
  }
  console.log('passed: ' + pass + '   failed: 0');
  console.log('✓ paypal-authorize-then-capture tests passed');
  process.exit(0);
})();
