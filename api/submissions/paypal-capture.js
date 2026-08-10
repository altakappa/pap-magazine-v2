/**
 * POST /api/submissions/paypal-capture — 서브미션 일회성 결제 확정
 *
 * body: { order_id }
 * →     { ok:true, outcome:'paid'|'duplicate'|'addon_recorded' }
 *
 * ⚠️ 브라우저가 보내온 order_id 를 그대로 믿지 않는다. PayPal 에서 주문을 다시
 *    읽어 custom_id(서버가 심은 값)와 실제 결제 금액을 확인한 뒤에만 DB 를 바꾼다.
 *
 * 멱등성: submissions.paypal_order_id 에 부분 UNIQUE 인덱스가 걸려 있다.
 *   같은 주문으로 두 번 들어와도 DB 가 거부한다 — 2026-08-07 lia.line 이중결제
 *   사고를 애플리케이션이 아니라 스키마 수준에서 막는다.
 *
 * 발행(status/approved/published)은 절대 건드리지 않는다. 게재 판단은 사람 몫이다.
 */

'use strict';

const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { paypalFetch, resolveAmount, centsToValue, parseCustomId } = require('../_lib/paypalOrders');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  const orderId = String((req.body && req.body.order_id) || '');
  if (!orderId) return res.status(400).json({ message: 'order_id required' });

  try {
    // 1) 캡처. 이미 캡처된 주문이면 422(ORDER_ALREADY_CAPTURED) 가 온다 — 멱등 처리.
    const cap = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST' });
    const alreadyCaptured = !cap.ok && JSON.stringify(cap.body).indexOf('ORDER_ALREADY_CAPTURED') !== -1;
    if (!cap.ok && !alreadyCaptured) {
      console.error('[paypal-capture] 캡처 실패', cap.status, JSON.stringify(cap.body).slice(0, 300));
      return res.status(502).json({ message: 'Payment capture failed. Please contact PAP.' });
    }

    // 2) 주문 원본을 다시 읽어 진실을 확인한다 (브라우저 말이 아니라 PayPal 말).
    const ord = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
    if (!ord.ok) {
      console.error('[paypal-capture] 주문 조회 실패', ord.status);
      return res.status(502).json({ message: 'Could not verify payment. Please contact PAP.' });
    }
    const pu = (ord.body.purchase_units || [])[0] || {};
    const meta = parseCustomId(pu.custom_id);
    if (!meta || !meta.submissionId) {
      console.error('[paypal-capture] custom_id 해석 불가:', pu.custom_id);
      return res.status(400).json({ message: 'Unrecognized payment' });
    }
    const captured = ((pu.payments || {}).captures || [])[0] || {};
    if (String(captured.status).toUpperCase() !== 'COMPLETED') {
      return res.status(409).json({ message: 'Payment not completed' });
    }

    const { data: sub, error } = await supabaseAdmin
      .from('submissions')
      .select('id, user_id, description, payment_status, paid_amount, paypal_order_id, admin_notes')
      .eq('id', meta.submissionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) return res.status(404).json({ message: 'Submission not found' });
    if (String(sub.user_id) !== String(user.id)) return res.status(403).json({ message: 'Not your submission' });

    // 3) 실제 결제된 금액이 서버가 정한 금액과 같은지 확인 (과소 결제 차단).
    const amt = resolveAmount(sub, meta.kind, meta.addon);
    if (amt.error) return res.status(400).json({ message: 'Cannot price this item' });
    const paidValue = (captured.amount && captured.amount.value) || '';
    const paidCurrency = (captured.amount && captured.amount.currency_code) || '';
    if (paidCurrency !== 'EUR' || paidValue !== centsToValue(amt.cents)) {
      console.error('[paypal-capture] 금액 불일치 expected', centsToValue(amt.cents), 'got', paidValue, paidCurrency, 'order', orderId);
      sendTextToTelegramSafe('🚨 PayPal 서브미션 결제 금액 불일치 order=' + orderId + ' 기대=' + centsToValue(amt.cents) + 'EUR 실제=' + paidValue + paidCurrency);
      return res.status(409).json({ message: 'Amount mismatch. Please contact PAP.' });
    }

    // 4) 반영
    if (meta.kind === 'submission_addon') {
      // 애드온은 전용 컬럼이 없다. Paddle 시절엔 결제사 대시보드에만 남아
      // 계정이 닫히면 기록이 통째로 사라지는 구조였다. 최소한 우리 DB 에 남긴다.
      const line = `[${new Date().toISOString().slice(0, 10)}] PayPal 애드온 결제: ${meta.addon} €${paidValue} (order ${orderId})`;
      const notes = sub.admin_notes ? (sub.admin_notes + '\n' + line) : line;
      await supabaseAdmin.from('submissions').update({ admin_notes: notes }).eq('id', sub.id);
      sendTextToTelegramSafe('💶 서브미션 애드온 결제 ' + meta.addon + ' €' + paidValue + ' · submission=' + sub.id);
      return res.status(200).json({ ok: true, outcome: 'addon_recorded' });
    }

    if (String(sub.payment_status) === 'paid') {
      return res.status(200).json({ ok: true, outcome: 'duplicate' });
    }

    const { error: upErr } = await supabaseAdmin.from('submissions').update({
      payment_status: 'paid',
      paid_amount: amt.cents,
      paypal_order_id: orderId,
      payment_provider: 'paypal',
    }).eq('id', sub.id);
    if (upErr) {
      // UNIQUE 위반이면 이미 처리된 주문 — 성공으로 본다.
      if (/duplicate key|unique/i.test(upErr.message)) {
        return res.status(200).json({ ok: true, outcome: 'duplicate' });
      }
      throw new Error(upErr.message);
    }

    sendTextToTelegramSafe('💶 서브미션 기본료 결제 €' + paidValue + ' · submission=' + sub.id);
    return res.status(200).json({ ok: true, outcome: 'paid' });
  } catch (e) {
    console.error('[paypal-capture] 예외:', e.message);
    return res.status(500).json({ message: 'Payment verification failed. Please contact PAP.' });
  }
};
