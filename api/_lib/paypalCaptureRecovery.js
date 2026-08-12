/**
 * 서브미션 일회성 결제(PayPal Orders) 복구 그물 — 2026-08-12
 *
 * ■ 왜 필요한가
 *   구독 웹훅은 500 을 던지면 PayPal 이 재시도해 자동 복구된다. 그런데 서브미션
 *   게재료(€380/€790)와 애드온(€110/€220)은 브라우저→서버 왕복 한 번
 *   (api/submissions/paypal-capture.js)이 전부였다. 그 한 번이 실패하면 돈은
 *   받았는데 DB 는 안 바뀌고, 되돌릴 방법이 없었다.
 *   PAYMENT.CAPTURE.COMPLETED 를 받는 것만으로 그 갈래가 전부 자동 복구된다.
 *
 *   환불도 마찬가지다. PayPal 대시보드에서 직접 환불하면 우리 DB 의
 *   payment_status 는 영원히 'paid' 로 남아 환불된 건이 게재 대기열에 계속 선다.
 *
 * ■ 정상 동작하면 이 코드는 아무 일도 하지 않는다
 *   paypal-capture.js 가 먼저 반영했으면 여기 오는 이벤트는 "이미 반영됨" 으로
 *   조용히 끝난다. 그게 정상이다. 이 코드는 그 한 번이 실패했을 때만 일한다.
 *   그래서 모든 경로가 멱등이어야 한다.
 */

'use strict';

const { sendTextToTelegramSafe } = require('./telegram');
const { parseCustomId } = require('./paypalOrders');

// paypal-capture.js 가 정상 동작했으면 여기 오는 이벤트는 전부 "이미 반영됨"
// 으로 조용히 끝난다. 그게 정상이다. 이 코드는 그 한 번이 실패했을 때만 일한다.

/** 캡처 이벤트에서 주문 ID 를 뽑는다 (없으면 캡처 ID 로 대체) */
function captureOrderId(resource) {
  const rel = ((resource.supplementary_data || {}).related_ids) || {};
  return rel.order_id || resource.id || null;
}

async function handleCaptureCompleted(db, resource) {
  const meta = parseCustomId(resource.custom_id);
  if (!meta || !meta.submissionId) return { ignored: 'no_custom_id' };
  const orderId = captureOrderId(resource);
  const value = ((resource.amount || {}).value) || '';
  const currency = ((resource.amount || {}).currency_code) || '';

  const { data: sub, error } = await db
    .from('submissions')
    .select('id, payment_status, paypal_order_id, admin_notes')
    .eq('id', meta.submissionId)
    .maybeSingle();
  if (error) throw new Error('submission lookup failed: ' + error.message);
  if (!sub) {
    await sendTextToTelegramSafe('🚨 PayPal 캡처 완료 이벤트인데 서브미션을 못 찾음 submission='
      + meta.submissionId + ' order=' + orderId + ' ' + value + currency);
    return { unmatched: true };
  }

  if (meta.kind === 'submission_addon') {
    // 이미 같은 주문이 기록돼 있으면 아무것도 하지 않는다(멱등).
    if (String(sub.admin_notes || '').indexOf(String(orderId)) !== -1) return { already: true };
    const line = '[' + new Date().toISOString().slice(0, 10) + '] PayPal 애드온 결제: '
      + meta.addon + ' €' + value + ' (order ' + orderId + ')';
    const notes = sub.admin_notes ? (sub.admin_notes + '\n' + line) : line;
    const { error: aErr } = await db.from('submissions')
      .update({ admin_notes: notes }).eq('id', sub.id);
    if (aErr) throw new Error('addon note write failed: ' + aErr.message);
    await sendTextToTelegramSafe('💶 [웹훅 복구] 애드온 결제 기록 ' + meta.addon + ' €' + value
      + ' · submission=' + sub.id);
    return { recovered: 'addon' };
  }

  if (String(sub.payment_status) === 'paid') return { already: true };

  // 금액은 여기서 다시 판정하지 않는다 — paypal-capture.js 가 캡처 전에 이미
  // 대조했고, 웹훅은 그 결과를 뒤늦게 반영하는 복구 경로다. 다만 사람이 볼 수
  // 있도록 실제 결제 금액을 그대로 남긴다.
  const cents = Math.round(parseFloat(value || '0') * 100);
  const { error: upErr } = await db.from('submissions').update({
    payment_status: 'paid',
    paid_amount: isFinite(cents) && cents > 0 ? cents : null,
    paypal_order_id: orderId,
    payment_provider: 'paypal',
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);
  if (upErr) {
    if (/duplicate key|unique/i.test(upErr.message)) return { already: true };
    throw new Error('submission payment write failed: ' + upErr.message);
  }
  await sendTextToTelegramSafe('💶 [웹훅 복구] 게재료 결제 반영 €' + value + currency
    + ' · submission=' + sub.id + ' order=' + orderId
    + ' — 브라우저 확정이 실패했지만 웹훅이 메웠습니다.');
  return { recovered: 'submission_fee' };
}

async function handleCaptureRefunded(db, resource, eventType) {
  // 환불 resource 에는 custom_id 가 없을 수 있다. 두 갈래로 찾는다.
  let sub = null;
  const meta = parseCustomId(resource.custom_id);
  if (meta && meta.submissionId) {
    const { data } = await db.from('submissions')
      .select('id, payment_status').eq('id', meta.submissionId).maybeSingle();
    sub = data || null;
  }
  if (!sub) {
    const orderId = captureOrderId(resource);
    if (orderId) {
      const { data } = await db.from('submissions')
        .select('id, payment_status').eq('paypal_order_id', orderId).maybeSingle();
      sub = data || null;
    }
  }
  const amount = ((resource.amount || {}).value || '') + ((resource.amount || {}).currency_code || '');
  if (!sub) {
    // 구독 환불이거나 우리가 못 찾는 건이다. 조용히 넘기지 않는다.
    await sendTextToTelegramSafe('🚨 PayPal ' + eventType + ' — 대상 서브미션을 못 찾음. '
      + '금액 ' + amount + ' refund=' + resource.id + ' — 수동 확인 필요.');
    return { unmatched: true };
  }
  const { error } = await db.from('submissions')
    .update({ payment_status: 'refunded', updated_at: new Date().toISOString() })
    .eq('id', sub.id);
  if (error) throw new Error('refund write failed: ' + error.message);
  await sendTextToTelegramSafe('↩️ PayPal 환불 반영 ' + amount + ' · submission=' + sub.id
    + ' — 게재 대기열에서 빼야 하는지 확인해 주세요.');
  return { refunded: true };
}

module.exports = { handleCaptureCompleted, handleCaptureRefunded, captureOrderId };
