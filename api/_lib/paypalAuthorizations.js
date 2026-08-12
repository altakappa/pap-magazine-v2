/**
 * 승인후결제 (PayPal authorize → capture / void) — 공용 로직
 * 2026-08-12 · 도메니코 지시
 *
 * ■ 왜 바꿨나
 *   종전: 심사 승인 → 크리에이터에게 "이제 €790 내세요" → 결제.
 *   실측: 승인 66건 중 결제 0건. 이미 원하는 것(승인)을 받은 뒤에 지불을
 *   결정하는 구조라 낼 이유가 약했다.
 *
 *   변경: 제출 시점에 결제를 **승인(authorize)** 만 받는다. 돈은 묶이되 빠지지
 *   않는다. 심사에서 통과하면 그때 캡처(청구), 떨어지면 보이드(무청구).
 *   크리에이터 입장에서 "떨어지면 안 낸다" 가 명시되므로 장벽이 낮아진다.
 *
 * ■ 왜 재승인(re-authorize) 로직이 없나
 *   PayPal Honor Period 는 3일이다(그 뒤 29일까지는 재승인 필요).
 *   도메니코가 **2일 SLA** 를 정했다 — 2일 안에 반드시 심사하고, 넘기면
 *   자동 보이드. 2일 < 3일 이므로 재승인 경로 자체가 생기지 않는다.
 *   SLA 를 늘리려면 reauthorize 를 먼저 구현해야 한다. 지금은 의도적으로 없다.
 *
 * ■ 돈이 움직이는 지점은 capture 단 하나다
 *   authorize 는 돈을 묶기만 한다. void 는 묶은 걸 푼다(환불이 아니다 —
 *   빠진 적이 없다). 카드사에 따라 한도 복구까지 며칠 걸릴 수 있고, 그건
 *   고객 안내 문구의 책임이다.
 */

'use strict';

const { paypalFetch, centsToValue } = require('./paypalOrders');

// PayPal Honor Period. 이 안에 캡처해야 성공률이 보장된다.
const HONOR_PERIOD_HOURS = 72;
// 도메니코 SLA — 이 시간을 넘긴 미심사 건은 자동 보이드한다. Honor Period 보다
// 반드시 짧아야 한다(짧지 않으면 재승인 로직이 필요해진다).
const REVIEW_SLA_HOURS = 48;

if (REVIEW_SLA_HOURS >= HONOR_PERIOD_HOURS) {
  // 설정 실수를 배포 시점에 죽인다 — 조용히 만료되는 것보다 낫다.
  throw new Error('REVIEW_SLA_HOURS must be shorter than HONOR_PERIOD_HOURS');
}

/** 승인 확정 — 승인된 주문을 authorization 으로 굳힌다. 돈은 아직 안 빠진다. */
async function authorizeOrder(orderId) {
  const r = await paypalFetch('/v2/checkout/orders/' + encodeURIComponent(orderId) + '/authorize', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!r.ok) return { ok: false, status: r.status, body: r.body };
  const pu = ((r.body.purchase_units || [])[0]) || {};
  const auth = (((pu.payments || {}).authorizations || [])[0]) || {};
  if (!auth.id) return { ok: false, status: r.status, body: r.body, reason: 'no_authorization_id' };
  return {
    ok: true,
    authorizationId: auth.id,
    status: String(auth.status || '').toUpperCase(),
    amount: auth.amount || null,
    expirationTime: auth.expiration_time || null,
    raw: r.body,
  };
}

/** 승인 조회 — 캡처/보이드 전에 상태와 금액을 서버가 다시 읽는다. */
async function getAuthorization(authorizationId) {
  const r = await paypalFetch('/v2/payments/authorizations/' + encodeURIComponent(authorizationId), {
    method: 'GET',
  });
  return { ok: r.ok, status: r.status, body: r.body };
}

/**
 * 캡처 — 💰 여기서 처음 실제로 돈이 빠진다.
 * 금액은 인자로 받지 않고 호출부가 서버 산출가를 넘긴다(위조 차단).
 */
async function captureAuthorization(authorizationId, cents, requestId) {
  const headers = {};
  if (requestId) headers['PayPal-Request-Id'] = String(requestId).slice(0, 108);
  const r = await paypalFetch('/v2/payments/authorizations/' + encodeURIComponent(authorizationId) + '/capture', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amount: { currency_code: 'EUR', value: centsToValue(cents) },
      final_capture: true,
    }),
  });
  if (!r.ok) return { ok: false, status: r.status, body: r.body, code: paypalIssue(r.body) };
  return { ok: true, captureId: r.body.id, status: String(r.body.status || '').toUpperCase(), raw: r.body };
}

/** 보이드 — 묶인 돈을 푼다. 청구되지 않는다. */
async function voidAuthorization(authorizationId) {
  const r = await paypalFetch('/v2/payments/authorizations/' + encodeURIComponent(authorizationId) + '/void', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  // 이미 보이드됐거나 이미 캡처된 건은 여기서 4xx 가 난다. 호출부가 구분해야 하므로
  // PayPal 이슈 코드를 그대로 올린다.
  if (!r.ok) return { ok: false, status: r.status, body: r.body, code: paypalIssue(r.body) };
  return { ok: true, raw: r.body };
}

/** PayPal 오류 본문에서 대표 issue 코드를 꺼낸다. 없으면 name, 그것도 없으면 ''. */
function paypalIssue(body) {
  try {
    const d = (body && body.details) || [];
    if (d.length && d[0].issue) return String(d[0].issue).toUpperCase();
    if (body && body.name) return String(body.name).toUpperCase();
  } catch (_) { /* noop */ }
  return '';
}

/** 이미 끝난 상태라 다시 손댈 필요가 없는 보이드 실패인가 (멱등 처리용) */
function isAlreadySettled(code) {
  return code === 'AUTHORIZATION_ALREADY_CAPTURED'
      || code === 'AUTHORIZATION_VOIDED'
      || code === 'PREVIOUSLY_VOIDED'
      || code === 'PREVIOUSLY_CAPTURED'
      || code === 'RESOURCE_NOT_FOUND';
}

/** 승인 시각 → Honor Period 만료 시각 */
function honorExpiryFrom(authorizedAtIso) {
  const t = new Date(authorizedAtIso).getTime();
  return new Date(t + HONOR_PERIOD_HOURS * 3600 * 1000).toISOString();
}

/** 승인 시각 → SLA 마감(이 시각을 넘기면 자동 보이드) */
function slaDeadlineFrom(authorizedAtIso) {
  const t = new Date(authorizedAtIso).getTime();
  return new Date(t + REVIEW_SLA_HOURS * 3600 * 1000).toISOString();
}

/** 지금 기준으로 SLA 를 넘겼는가 */
function isPastSla(authorizedAtIso, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return now >= new Date(slaDeadlineFrom(authorizedAtIso)).getTime();
}

module.exports = {
  HONOR_PERIOD_HOURS,
  REVIEW_SLA_HOURS,
  authorizeOrder,
  getAuthorization,
  captureAuthorization,
  voidAuthorization,
  paypalIssue,
  isAlreadySettled,
  honorExpiryFrom,
  slaDeadlineFrom,
  isPastSla,
};
