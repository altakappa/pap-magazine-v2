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
 * 🔴 2026-08-12 순서 재설계 — "돈이 움직인 뒤에 실패하는 구간" 을 최소화한다.
 *
 *   예전 순서는 capture(= 실제 돈 인출)가 이 파일의 첫 부수효과였다. 그래서
 *   소유자 확인 · 금액 확인 · 서브미션 조회 · 중복 확인이 전부 "돈이 이미
 *   나간 뒤" 에 일어났고, 실패 갈래 9개 중 8개는 조용히 4xx/5xx 만 뱉었다.
 *   회원 화면에는 "잠시 후 다시 시도해 주세요" 가 떴고, 다시 누르면 새 주문이
 *   발급되어 **진짜로 두 번 청구**됐다.
 *
 *   지금 순서:
 *     1) 주문 GET (읽기 전용 — 돈 안 움직임)
 *     2) custom_id 해석 → 서브미션 조회 → 소유자 확인
 *     3) 주문에 실린 금액이 서버 산출가와 같은지 확인
 *     4) 기본료가 이미 결제된 건이면 **캡처하지 않고 멈춘다** (이중청구 원천 차단)
 *     5) 주문 상태 확인 (APPROVED 가 아니면 캡처하지 않는다)
 *     6) ── 여기서부터 돈이 움직인다 ── capture
 *     7) 캡처된 금액 재확인 → DB 반영
 *
 *   6번 이후의 모든 실패에는 텔레그램 경고를 보낸다. 돈을 받은 사실 자체를
 *   아무도 모르는 상태가 제일 위험하다. 그리고 회원에게는 code 로
 *   `paid_but_unconfirmed` 를 내려 "다시 결제하지 말라" 고 말한다.
 *
 * 발행(status/approved/published)은 절대 건드리지 않는다. 게재 판단은 사람 몫이다.
 */

'use strict';

const { requireAuthStrict } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { paypalFetch, resolveAmount, centsToValue, parseCustomId } = require('../_lib/paypalOrders');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

/**
 * 돈은 받았는데 우리 쪽 처리가 어긋난 상태. 사람이 즉시 알아야 한다.
 * await 한다 — 서버리스는 응답을 반환하면 그 자리에서 얼 수 있어서,
 * 띄워만 두면 알림이 유실된다. 이 알림은 유실되면 안 되는 종류다.
 */
async function alertStuck(text) {
  try { await sendTextToTelegramSafe(text); } catch (_) { /* 알림 실패가 응답을 막지 않는다 */ }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  /* 2026-09-04 보안감사 (2군 C) — 결제 경로는 strict 로. requireAuth 는 DB 를 안 봐서
     로그아웃(token_version 증가) 뒤에도 옛 토큰이 7일간 먹는다. 돈이 걸린 곳은 매 요청
     DB 에서 token_version·role 을 대조한다(auth.js:110 주석의 원칙과 일치). */
  const user = await requireAuthStrict(req, res);
  if (!user) return;

  const orderId = String((req.body && req.body.order_id) || '');
  if (!orderId) return res.status(400).json({ message: 'order_id required' });

  try {
    // ── 1) 주문을 읽는다. 읽기만 한다 — 여기서는 돈이 움직이지 않는다. ──────
    const ord = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
    if (!ord.ok) {
      console.error('[paypal-capture] 주문 조회 실패', ord.status, JSON.stringify(ord.body).slice(0, 200));
      return res.status(502).json({ code: 'order_lookup_failed', message: 'Could not verify payment. Please contact PAP.' });
    }
    const pu = (ord.body.purchase_units || [])[0] || {};
    const meta = parseCustomId(pu.custom_id);
    if (!meta || !meta.submissionId) {
      console.error('[paypal-capture] custom_id 해석 불가:', pu.custom_id);
      return res.status(400).json({ code: 'unrecognized', message: 'Unrecognized payment' });
    }

    // ── 2) 서브미션 조회 + 소유자 확인 ─────────────────────────────────────
    const { data: sub, error } = await supabaseAdmin
      .from('submissions')
      .select('id, user_id, description, payment_status, paid_amount, paypal_order_id, admin_notes')
      .eq('id', meta.submissionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) return res.status(404).json({ code: 'not_found', message: 'Submission not found' });
    if (String(sub.user_id) !== String(user.id)) {
      return res.status(403).json({ code: 'not_owner', message: 'Not your submission' });
    }

    // ── 3) 주문에 실린 금액이 서버 산출가와 같은가 (캡처 전에 본다) ────────
    const amt = resolveAmount(sub, meta.kind, meta.addon);
    if (amt.error) return res.status(400).json({ code: 'cannot_price', message: 'Cannot price this item' });
    const expected = centsToValue(amt.cents);
    const orderValue = ((pu.amount || {}).value) || '';
    const orderCurrency = ((pu.amount || {}).currency_code) || '';
    if (orderCurrency !== 'EUR' || orderValue !== expected) {
      console.error('[paypal-capture] 주문 금액 불일치 expected', expected, 'got', orderValue, orderCurrency, 'order', orderId);
      await alertStuck('🚨 PayPal 주문 금액 불일치(캡처 안 함) order=' + orderId
        + ' 기대=' + expected + 'EUR 실제=' + orderValue + orderCurrency + ' submission=' + sub.id);
      return res.status(409).json({ code: 'amount_mismatch', message: 'Amount mismatch. Please contact PAP.' });
    }

    // ── 4) 기본료가 이미 결제된 건이면 캡처하지 않는다 ─────────────────────
    // 🔴 이중청구를 막는 결정적 지점. 예전에는 이 검사가 캡처 뒤에 있어서,
    //    "이미 냈다" 는 사실을 확인하는 순간에는 두 번째 돈이 이미 나간 뒤였다.
    //    승인만 되고 캡처 안 된 주문은 PayPal 에서 자동 만료된다(돈 안 나감).
    if (meta.kind === 'submission_fee' && String(sub.payment_status) === 'paid') {
      const sameOrder = sub.paypal_order_id && String(sub.paypal_order_id) === orderId;
      if (sameOrder) {
        // 같은 주문을 다시 보낸 것 — 네트워크 재시도 등. 정상 응답.
        return res.status(200).json({ ok: true, outcome: 'duplicate' });
      }
      // 다른 주문으로 또 결제하려 한 것. 캡처하지 않고 막는다.
      await alertStuck('⚠️ 이미 결제된 서브미션에 새 주문이 승인됐다(캡처 안 함) submission=' + sub.id
        + ' 기존order=' + (sub.paypal_order_id || '없음') + ' 새order=' + orderId
        + ' — PayPal 에서 이 주문을 void 해 주세요.');
      return res.status(409).json({ code: 'already_paid', message: 'This submission is already paid. You have not been charged again.' });
    }

    // ── 5) 주문 상태 확인 ──────────────────────────────────────────────────
    const orderStatus = String(ord.body.status || '').toUpperCase();
    const alreadyCompleted = orderStatus === 'COMPLETED';
    if (!alreadyCompleted && orderStatus !== 'APPROVED') {
      // CREATED · PAYER_ACTION_REQUIRED · VOIDED 등 — 캡처할 수 없다. 돈은 안 나갔다.
      return res.status(409).json({ code: 'not_approved', message: 'Payment not completed' });
    }

    // ═══ 여기서부터 돈이 움직인다 ══════════════════════════════════════════
    let capBody = ord.body;
    if (!alreadyCompleted) {
      const cap = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST' });
      const alreadyCaptured = !cap.ok && JSON.stringify(cap.body).indexOf('ORDER_ALREADY_CAPTURED') !== -1;
      if (!cap.ok && !alreadyCaptured) {
        console.error('[paypal-capture] 캡처 실패', cap.status, JSON.stringify(cap.body).slice(0, 300));
        // 캡처 자체가 거절됐다 = 돈은 안 나갔다. 다시 시도해도 안전하다.
        return res.status(502).json({ code: 'capture_failed', message: 'Payment capture failed. Please contact PAP.' });
      }
      if (cap.ok) capBody = cap.body;
      else {
        // ORDER_ALREADY_CAPTURED — 진실을 다시 읽는다.
        const re = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
        if (re.ok) capBody = re.body;
      }
    }

    // ── 6) 캡처된 금액 재확인 (방어 심층) ──────────────────────────────────
    const cpu = (capBody.purchase_units || [])[0] || {};
    const captured = ((cpu.payments || {}).captures || [])[0] || {};
    const paidValue = (captured.amount && captured.amount.value) || '';
    const paidCurrency = (captured.amount && captured.amount.currency_code) || '';
    if (String(captured.status).toUpperCase() !== 'COMPLETED') {
      await alertStuck('🚨 캡처 후 상태가 COMPLETED 가 아니다 order=' + orderId
        + ' status=' + captured.status + ' submission=' + sub.id + ' — PayPal 에서 직접 확인 필요.');
      return res.status(409).json({ code: 'paid_but_unconfirmed', message: 'Payment could not be confirmed. Please contact PAP. Do not pay again.' });
    }
    if (paidCurrency !== 'EUR' || paidValue !== expected) {
      console.error('[paypal-capture] 캡처 금액 불일치 expected', expected, 'got', paidValue, paidCurrency, 'order', orderId);
      await alertStuck('🚨 캡처된 금액이 기대와 다르다(환불 검토) order=' + orderId
        + ' 기대=' + expected + 'EUR 실제=' + paidValue + paidCurrency + ' submission=' + sub.id);
      return res.status(409).json({ code: 'paid_but_unconfirmed', message: 'Amount mismatch. Please contact PAP. Do not pay again.' });
    }

    // ── 7) DB 반영 ────────────────────────────────────────────────────────
    if (meta.kind === 'submission_addon') {
      // 애드온은 전용 컬럼이 없다. Paddle 시절엔 결제사 대시보드에만 남아
      // 계정이 닫히면 기록이 통째로 사라지는 구조였다. 최소한 우리 DB 에 남긴다.
      const line = `[${new Date().toISOString().slice(0, 10)}] PayPal 애드온 결제: ${meta.addon} €${paidValue} (order ${orderId})`;
      const notes = sub.admin_notes ? (sub.admin_notes + '\n' + line) : line;
      // 2026-08-12 — 예전에는 이 update 의 error 를 보지 않고 ok:true 를 돌려줬다.
      // 실패해도 텔레그램은 나가서 "결제됐다" 고 믿게 된다. 유일한 기록인데.
      const { error: aErr } = await supabaseAdmin.from('submissions').update({ admin_notes: notes }).eq('id', sub.id);
      if (aErr) {
        await alertStuck('🚨 애드온 €' + paidValue + ' 를 받았는데 기록 실패 submission=' + sub.id
          + ' order=' + orderId + ' addon=' + meta.addon + ' err=' + aErr.message
          + ' — admin_notes 에 수동으로 남겨 주세요.');
        return res.status(500).json({ code: 'paid_but_unconfirmed', message: 'Payment received but not recorded. Please contact PAP. Do not pay again.' });
      }
      await alertStuck('💶 서브미션 애드온 결제 ' + meta.addon + ' €' + paidValue + ' · submission=' + sub.id);
      return res.status(200).json({ ok: true, outcome: 'addon_recorded' });
    }

    const { error: upErr } = await supabaseAdmin.from('submissions').update({
      payment_status: 'paid',
      paid_amount: amt.cents,
      paypal_order_id: orderId,
      payment_provider: 'paypal',
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    if (upErr) {
      // UNIQUE 위반이면 이미 처리된 주문 — 성공으로 본다.
      if (/duplicate key|unique/i.test(upErr.message)) {
        return res.status(200).json({ ok: true, outcome: 'duplicate' });
      }
      // 🔴 돈은 받았는데 DB 가 안 바뀌었다. 이게 제일 위험한 상태다.
      await alertStuck('🚨 €' + paidValue + ' 를 받았는데 DB 반영 실패 submission=' + sub.id
        + ' order=' + orderId + ' err=' + upErr.message
        + ' — payment_status 를 수동으로 paid 로 바꿔 주세요.');
      return res.status(500).json({ code: 'paid_but_unconfirmed', message: 'Payment received but not recorded. Please contact PAP. Do not pay again.' });
    }

    await alertStuck('💶 서브미션 기본료 결제 €' + paidValue + ' · submission=' + sub.id);
    return res.status(200).json({ ok: true, outcome: 'paid' });
  } catch (e) {
    console.error('[paypal-capture] 예외:', e.message);
    // 예외가 캡처 전에 났는지 후에 났는지 여기서는 알 수 없다. 안전한 쪽으로
    // 말한다 — "다시 결제하지 마세요". 회원에게 재시도를 권하는 것이 최악이다.
    await alertStuck('🚨 paypal-capture 예외 order=' + orderId + ' err=' + e.message
      + ' — PayPal 활동내역에서 이 주문이 캡처됐는지 확인해 주세요.');
    return res.status(500).json({ code: 'paid_but_unconfirmed', message: 'Payment verification failed. Please contact PAP. Do not pay again.' });
  }
};
