/**
 * POST /api/submissions/paypal-authorize — 게재료 결제 "승인" 확정
 *
 * body: { order_id }
 * →     { ok:true, outcome:'authorized'|'duplicate', slaDeadline }
 *
 * ■ 여기서는 돈이 빠지지 않는다
 *   AUTHORIZE 주문을 authorization 으로 굳혀 금액을 묶기만 한다.
 *   실제 청구는 심사 승인 시 review.js 가 capture 할 때 처음 일어난다.
 *   거절·보완·SLA(2일) 초과는 void — 청구 없음.
 *
 * ■ 순서 (paypal-capture.js 의 교훈을 그대로 따른다)
 *   1) 주문 GET(읽기 전용)
 *   2) custom_id 해석 → 서브미션 조회 → 소유자 확인
 *   3) 주문 금액 == 서버 산출가 확인
 *   4) 이미 승인/결제된 건인지 확인
 *   5) ── 여기서부터 카드 한도가 묶인다 ── authorize
 *   6) 승인 금액 재확인 → DB 반영
 *
 * ■ 실패는 조용히 넘기지 않는다
 *   승인 후 DB 반영에 실패하면 "묶였는데 우리가 모르는" 상태가 된다.
 *   그러면 심사도 못 하고 보이드도 못 한다 → 텔레그램으로 즉시 올린다.
 */

'use strict';

const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { paypalFetch, resolveAmount, centsToValue, parseCustomId } = require('../_lib/paypalOrders');
const {
  authorizeOrder, voidAuthorization, honorExpiryFrom, slaDeadlineFrom, REVIEW_SLA_HOURS,
} = require('../_lib/paypalAuthorizations');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

// 알림은 반드시 await 한다 — 서버리스는 응답 반환 후 함수를 얼려 전송을 잃는다.
// (2026-08-12 샌드박스 리허설에서 실제로 당했다. 커밋 6a13439)
async function alertStuck(text) {
  try { await sendTextToTelegramSafe(text); } catch (_) { /* 알림 실패가 응답을 막지 않는다 */ }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  const orderId = String((req.body || {}).order_id || '');
  if (!orderId) return res.status(400).json({ message: 'order_id required' });

  let authorizationId = null;
  try {
    // ── 1) 주문 조회 (읽기 전용) ────────────────────────────────────────────
    const ord = await paypalFetch('/v2/checkout/orders/' + encodeURIComponent(orderId), { method: 'GET' });
    if (!ord.ok) {
      console.error('[paypal-authorize] 주문 조회 실패', ord.status);
      return res.status(502).json({ code: 'order_lookup_failed', message: 'Could not read the order.' });
    }
    const pu = ((ord.body.purchase_units || [])[0]) || {};
    const meta = parseCustomId(pu.custom_id);
    if (!meta || meta.kind !== 'submission_fee' || !meta.submissionId) {
      return res.status(400).json({ code: 'bad_custom_id', message: 'Unsupported order.' });
    }

    // ── 2) 서브미션 + 소유자 ────────────────────────────────────────────────
    const { data: sub, error: sErr } = await supabaseAdmin
      .from('submissions')
      .select('id, user_id, description, payment_status, paypal_authorization_id')
      .eq('id', meta.submissionId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!sub) return res.status(404).json({ code: 'submission_not_found', message: 'Submission not found' });
    if (String(sub.user_id) !== String(user.id)) {
      return res.status(403).json({ code: 'not_owner', message: 'Not your submission' });
    }

    // ── 3) 금액 대조 ────────────────────────────────────────────────────────
    const amt = resolveAmount(sub, 'submission_fee', null);
    if (amt.error) return res.status(400).json({ code: 'cannot_price', message: 'Cannot price this item' });
    const expected = centsToValue(amt.cents);
    const orderValue = ((pu.amount || {}).value) || '';
    const orderCurrency = ((pu.amount || {}).currency_code) || '';
    if (orderCurrency !== 'EUR' || orderValue !== expected) {
      await alertStuck('🚨 PayPal 승인 금액 불일치(승인 안 함) order=' + orderId
        + ' 기대=' + expected + 'EUR 실제=' + orderValue + orderCurrency + ' submission=' + sub.id);
      return res.status(409).json({ code: 'amount_mismatch', message: 'Amount mismatch. Please contact PAP.' });
    }

    // ── 4) 이미 승인/결제됨 ─────────────────────────────────────────────────
    if (String(sub.payment_status) === 'paid') {
      return res.status(409).json({ code: 'already_paid', message: 'This submission is already paid.' });
    }
    if (String(sub.payment_status) === 'authorized' && sub.paypal_authorization_id) {
      // 같은 건을 다시 보낸 것(네트워크 재시도). 새로 묶지 않는다.
      return res.status(200).json({ ok: true, outcome: 'duplicate' });
    }

    // ── 5) 여기서부터 카드 한도가 묶인다 ────────────────────────────────────
    const a = await authorizeOrder(orderId);
    if (!a.ok) {
      console.error('[paypal-authorize] 승인 실패', a.status, JSON.stringify(a.body || {}).slice(0, 300));
      return res.status(502).json({ code: 'authorize_failed', message: 'Could not authorize the payment.' });
    }
    authorizationId = a.authorizationId;

    // ── 6) 승인 금액 재확인 ─────────────────────────────────────────────────
    const aVal = ((a.amount || {}).value) || '';
    const aCur = ((a.amount || {}).currency_code) || '';
    if (aCur !== 'EUR' || aVal !== expected) {
      // 우리가 기대한 금액이 아니면 묶어둘 이유가 없다 — 즉시 푼다.
      await voidAuthorization(authorizationId);
      await alertStuck('🚨 PayPal 승인 후 금액 불일치 — 즉시 보이드함 auth=' + authorizationId
        + ' 기대=' + expected + ' 실제=' + aVal + aCur + ' submission=' + sub.id);
      return res.status(409).json({ code: 'amount_mismatch', message: 'Amount mismatch. Please contact PAP.' });
    }

    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin.from('submissions').update({
      payment_status: 'authorized',
      paypal_authorization_id: authorizationId,
      payment_provider: 'paypal',
      paypal_order_id: orderId,
      authorized_at: nowIso,
      authorization_expires_at: honorExpiryFrom(nowIso),
      authorization_voided_at: null,
      updated_at: nowIso,
    }).eq('id', sub.id);

    if (upErr) {
      // 묶였는데 우리가 모르는 상태 — 가장 위험하다. 알리고, 푼다.
      await alertStuck('🚨 승인은 됐는데 DB 반영 실패 — 보이드 시도함 auth=' + authorizationId
        + ' submission=' + sub.id + ' err=' + upErr.message);
      const v = await voidAuthorization(authorizationId);
      return res.status(500).json({
        code: v.ok ? 'authorize_rolled_back' : 'authorized_but_unconfirmed',
        message: 'Could not confirm the authorization. Please contact PAP before trying again.',
      });
    }

    await alertStuck('🔒 게재료 결제 승인됨(청구 전) €' + expected + ' · submission=' + sub.id
      + '\n심사 마감: ' + slaDeadlineFrom(nowIso) + ' (' + REVIEW_SLA_HOURS + '시간)'
      + '\n승인하면 청구, 거절하면 청구되지 않습니다.');

    return res.status(200).json({
      ok: true,
      outcome: 'authorized',
      slaDeadline: slaDeadlineFrom(nowIso),
      slaHours: REVIEW_SLA_HOURS,
    });
  } catch (e) {
    console.error('[paypal-authorize] 예외:', e && e.message);
    if (authorizationId) {
      await alertStuck('🚨 승인 후 예외 — 수동 확인 필요 auth=' + authorizationId + ' err=' + (e && e.message));
      return res.status(500).json({ code: 'authorized_but_unconfirmed', message: 'Please contact PAP before trying again.' });
    }
    return res.status(500).json({ code: 'authorize_failed', message: 'Could not authorize the payment.' });
  }
};
