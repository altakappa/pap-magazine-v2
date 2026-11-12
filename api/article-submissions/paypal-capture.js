/**
 * POST /api/article-submissions/paypal-capture — 아티클 게재료(€790) 결제 확정
 *
 * body: { order_id }
 * →     { ok:true, outcome:'paid'|'duplicate' }
 *
 * ⚠️ 브라우저가 보내온 order_id 를 그대로 믿지 않는다. PayPal 에서 주문을 다시
 *    읽어 custom_id(서버가 심은 값)와 실제 결제 금액을 확인한 뒤에만 DB 를 바꾼다.
 *
 * 순서는 에디토리얼 캡처(api/submissions/paypal-capture.js)와 **같다.** 그 순서는
 * 2026-08-12 에 이중청구 사고를 겪고 다시 설계한 것이다 — "돈이 움직인 뒤에
 * 실패하는 구간" 을 최소화한다:
 *   1) 주문 GET (읽기 전용 — 돈 안 움직임)
 *   2) custom_id 해석 → 기고 조회 → 소유자 확인
 *   3) 주문에 실린 금액이 서버 산출가와 같은지 확인
 *   4) 이미 결제된 건이면 **캡처하지 않고 멈춘다** (이중청구 원천 차단)
 *   5) 주문 상태 확인 (APPROVED 가 아니면 캡처하지 않는다)
 *   6) ── 여기서부터 돈이 움직인다 ── capture
 *   7) 캡처된 금액 재확인 → DB 반영
 * 6번 이후의 실패에는 모두 텔레그램 경고를 보낸다. 돈을 받은 사실을 아무도
 * 모르는 상태가 가장 위험하다. 회원에게는 code=paid_but_unconfirmed 로
 * "다시 결제하지 마세요" 를 말한다.
 *
 * 멱등성은 스키마가 받친다 — article_submissions.paypal_order_id 에 부분 UNIQUE
 * 인덱스가 있다(마이그레이션 184). 애플리케이션 검사만으로는 경합을 못 막는다.
 *
 * 발행(status)은 건드리지 않는다. 결제가 끝나도 게재 판단은 도메니코 몫이다.
 */

'use strict';

const { requireAuthStrict } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { paypalFetch, resolveAmount, centsToValue, parseCustomId } = require('../_lib/paypalOrders');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

/* 돈은 받았는데 우리 쪽 처리가 어긋난 상태 — 사람이 즉시 알아야 한다.
   await 한다: 서버리스는 응답을 반환하면 그 자리에서 얼 수 있어서 띄워만 두면
   알림이 유실된다. 이 알림은 유실되면 안 되는 종류다. */
async function alertStuck(text) {
  try { await sendTextToTelegramSafe(text); } catch (_) { /* 알림 실패가 응답을 막지 않는다 */ }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const user = await requireAuthStrict(req, res);
  if (!user) return;

  const orderId = String((req.body && req.body.order_id) || '');
  if (!orderId) return res.status(400).json({ message: 'order_id required' });

  try {
    // ── 1) 주문을 읽는다. 읽기만 한다 — 여기서는 돈이 움직이지 않는다 ──────
    const ord = await paypalFetch('/v2/checkout/orders/' + encodeURIComponent(orderId), { method: 'GET' });
    if (!ord.ok) {
      console.error('[article paypal-capture] 주문 조회 실패', ord.status);
      return res.status(502).json({ code: 'order_lookup_failed', message: 'Could not verify payment. Please contact PAP.' });
    }
    const pu = (ord.body.purchase_units || [])[0] || {};
    const meta = parseCustomId(pu.custom_id);
    if (!meta || meta.kind !== 'article_fee' || !meta.submissionId) {
      console.error('[article paypal-capture] custom_id 해석 불가:', pu.custom_id);
      return res.status(400).json({ code: 'unrecognized', message: 'Unrecognized payment' });
    }

    // ── 2) 기고 조회 + 소유자 확인 ─────────────────────────────────────────
    const { data: sub, error } = await supabaseAdmin
      .from('article_submissions')
      .select('id, user_id, title, fee_type, payment_status, paypal_order_id')
      .eq('id', meta.submissionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) return res.status(404).json({ code: 'not_found', message: 'Submission not found' });
    if (String(sub.user_id) !== String(user.id)) {
      return res.status(403).json({ code: 'not_owner', message: 'Not your submission' });
    }

    // ── 3) 주문에 실린 금액이 서버 산출가와 같은가 (캡처 전에 본다) ────────
    const amt = resolveAmount(sub, 'article_fee', null);
    if (amt.error) return res.status(400).json({ code: 'cannot_price', message: 'Cannot price this item' });
    const expected = centsToValue(amt.cents);
    const orderValue = ((pu.amount || {}).value) || '';
    const orderCurrency = ((pu.amount || {}).currency_code) || '';
    if (orderCurrency !== 'EUR' || orderValue !== expected) {
      await alertStuck('🚨 아티클 주문 금액 불일치(캡처 안 함) order=' + orderId
        + ' 기대=' + expected + 'EUR 실제=' + orderValue + orderCurrency + ' article=' + sub.id);
      return res.status(409).json({ code: 'amount_mismatch', message: 'Amount mismatch. Please contact PAP.' });
    }

    // ── 4) 이미 결제된 건이면 캡처하지 않는다 ──────────────────────────────
    // 🔴 이중청구를 막는 결정적 지점. 이 검사가 캡처 뒤에 있으면 "이미 냈다" 를
    //    확인하는 순간에 두 번째 돈이 이미 나간 뒤다. 승인만 되고 캡처되지 않은
    //    주문은 PayPal 에서 자동 만료된다(돈 안 나감).
    if (String(sub.payment_status) === 'paid') {
      if (sub.paypal_order_id && String(sub.paypal_order_id) === orderId) {
        return res.status(200).json({ ok: true, outcome: 'duplicate' });   // 네트워크 재시도
      }
      await alertStuck('⚠️ 이미 결제된 아티클에 새 주문이 승인됐다(캡처 안 함) article=' + sub.id
        + ' 기존order=' + (sub.paypal_order_id || '없음') + ' 새order=' + orderId
        + ' — PayPal 에서 이 주문을 void 해 주세요.');
      return res.status(409).json({ code: 'already_paid', message: 'This submission is already paid. You have not been charged again.' });
    }

    // ── 5) 주문 상태 확인 ──────────────────────────────────────────────────
    const orderStatus = String(ord.body.status || '').toUpperCase();
    const alreadyCompleted = orderStatus === 'COMPLETED';
    if (!alreadyCompleted && orderStatus !== 'APPROVED') {
      return res.status(409).json({ code: 'not_approved', message: 'Payment not completed' });
    }

    // ═══ 여기서부터 돈이 움직인다 ══════════════════════════════════════════
    let capBody = ord.body;
    if (!alreadyCompleted) {
      const cap = await paypalFetch('/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', { method: 'POST' });
      const alreadyCaptured = !cap.ok && JSON.stringify(cap.body).indexOf('ORDER_ALREADY_CAPTURED') !== -1;
      if (!cap.ok && !alreadyCaptured) {
        console.error('[article paypal-capture] 캡처 실패', cap.status, JSON.stringify(cap.body).slice(0, 300));
        // 캡처 자체가 거절됐다 = 돈은 안 나갔다. 다시 시도해도 안전하다.
        return res.status(502).json({ code: 'capture_failed', message: 'Payment capture failed. Please contact PAP.' });
      }
      if (cap.ok) capBody = cap.body;
      else {
        const re = await paypalFetch('/v2/checkout/orders/' + encodeURIComponent(orderId), { method: 'GET' });
        if (re.ok) capBody = re.body;
      }
    }

    // ── 6) 캡처된 금액 재확인 (방어 심층) ──────────────────────────────────
    const cpu = (capBody.purchase_units || [])[0] || {};
    const captured = ((cpu.payments || {}).captures || [])[0] || {};
    const paidValue = (captured.amount && captured.amount.value) || '';
    const paidCurrency = (captured.amount && captured.amount.currency_code) || '';
    if (String(captured.status).toUpperCase() !== 'COMPLETED') {
      await alertStuck('🚨 아티클 캡처 후 상태가 COMPLETED 가 아니다 order=' + orderId
        + ' status=' + captured.status + ' article=' + sub.id + ' — PayPal 에서 직접 확인 필요.');
      return res.status(409).json({ code: 'paid_but_unconfirmed', message: 'Payment could not be confirmed. Please contact PAP. Do not pay again.' });
    }
    if (paidCurrency !== 'EUR' || paidValue !== expected) {
      await alertStuck('🚨 아티클 캡처 금액이 기대와 다르다(환불 검토) order=' + orderId
        + ' 기대=' + expected + 'EUR 실제=' + paidValue + paidCurrency + ' article=' + sub.id);
      return res.status(409).json({ code: 'paid_but_unconfirmed', message: 'Amount mismatch. Please contact PAP. Do not pay again.' });
    }

    // ── 7) DB 반영 ────────────────────────────────────────────────────────
    const { error: upErr } = await supabaseAdmin.from('article_submissions').update({
      payment_status: 'paid',
      paid_amount: amt.cents,
      paypal_order_id: orderId,
      payment_provider: 'paypal',
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    if (upErr) {
      if (/duplicate key|unique/i.test(upErr.message)) {
        return res.status(200).json({ ok: true, outcome: 'duplicate' });
      }
      // 🔴 돈은 받았는데 DB 가 안 바뀌었다. 제일 위험한 상태다.
      await alertStuck('🚨 아티클 €' + paidValue + ' 를 받았는데 DB 반영 실패 article=' + sub.id
        + ' order=' + orderId + ' err=' + upErr.message
        + ' — payment_status 를 수동으로 paid 로 바꿔 주세요.');
      return res.status(500).json({ code: 'paid_but_unconfirmed', message: 'Payment received but not recorded. Please contact PAP. Do not pay again.' });
    }

    await alertStuck('💶 아티클 게재료 결제 €' + paidValue + ' · article=' + sub.id
      + '\n제목: ' + String(sub.title || '').slice(0, 80)
      + '\n이제 심사 화면에서 승인할 수 있습니다.');
    return res.status(200).json({ ok: true, outcome: 'paid' });
  } catch (e) {
    console.error('[article paypal-capture] 예외:', e && e.message);
    // 예외가 캡처 전인지 후인지 여기서는 알 수 없다. 안전한 쪽으로 말한다 —
    // 회원에게 재시도를 권하는 것이 최악이다.
    await alertStuck('🚨 아티클 paypal-capture 예외 order=' + orderId + ' err=' + (e && e.message)
      + ' — PayPal 활동내역에서 이 주문이 캡처됐는지 확인해 주세요.');
    return res.status(500).json({ code: 'paid_but_unconfirmed', message: 'Payment verification failed. Please contact PAP. Do not pay again.' });
  }
};
