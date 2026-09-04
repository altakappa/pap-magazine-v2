/**
 * POST /api/submissions/paypal-order — 서브미션 일회성 결제 주문 생성
 *
 * body: { submission_id, kind: 'submission_fee' | 'submission_addon', addon? }
 * →     { id: '<PayPal order id>' }
 *
 * 금액은 서버가 정한다. 클라이언트는 "무엇을" 만 말하고 "얼마" 는 말하지 못한다.
 * 실제 결제 확정은 paypal-capture.js 가 한다.
 */

'use strict';

const { requireAuthStrict } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { paypalFetch, resolveAmount, centsToValue, buildCustomId } = require('../_lib/paypalOrders');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  /* 2026-09-04 보안감사 (2군 C) — 결제 경로는 strict 로. requireAuth 는 DB 를 안 봐서
     로그아웃(token_version 증가) 뒤에도 옛 토큰이 7일간 먹는다. 돈이 걸린 곳은 매 요청
     DB 에서 token_version·role 을 대조한다(auth.js:110 주석의 원칙과 일치). */
  const user = await requireAuthStrict(req, res);
  if (!user) return;

  if (process.env.PAYMENTS_PAUSED === '1') {
    return res.status(200).json({ paused: true, contactEmail: 'contact@pap-magazine.com' });
  }
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ message: 'Payment not configured.' });
  }

  const body = req.body || {};
  const submissionId = String(body.submission_id || '');
  const kind = body.kind === 'submission_addon' ? 'submission_addon' : 'submission_fee';
  const addon = body.addon ? String(body.addon) : null;
  if (!submissionId) return res.status(400).json({ message: 'submission_id required' });

  try {
    const { data: sub, error } = await supabaseAdmin
      .from('submissions')
      .select('id, user_id, title, description, status, payment_status, paypal_authorization_id')
      .eq('id', submissionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) return res.status(404).json({ message: 'Submission not found' });

    // 남의 서브미션 결제 금지 — 결제 자체는 무해해 보이지만, 결제 성공이
    // payment_status 를 뒤집으므로 소유자 확인이 반드시 필요하다.
    if (String(sub.user_id) !== String(user.id)) {
      return res.status(403).json({ message: 'Not your submission' });
    }
    // 기본료 중복 결제 방지 (애드온은 여러 번 살 수 있다)
    if (kind === 'submission_fee' && String(sub.payment_status) === 'paid') {
      return res.status(409).json({ code: 'already_paid', message: 'Already paid' });
    }
    // 2026-08-12 — 이미 승인(authorize)이 잡혀 있으면 새로 묶지 않는다.
    // 두 번 묶으면 크리에이터 카드에 €790 이 두 번 걸린다. 청구는 아니지만
    // 한도가 두 배로 잠기고, 문의로 돌아온다.
    if (kind === 'submission_fee' && String(sub.payment_status) === 'authorized') {
      return res.status(409).json({ code: 'already_authorized', message: 'Payment already authorized' });
    }

    const amt = resolveAmount(sub, kind, addon);
    if (amt.error) return res.status(400).json({ code: amt.error, message: 'Cannot price this item' });

    // 🔴 2026-08-12 — 서버측 멱등키. 같은 건에 대한 재시도가 새 주문을 만들지 않는다.
    //
    // 사고 경로: 캡처는 성공했는데 우리 쪽 반영이 실패 → 회원 화면에 "다시 시도"
    // → 여기서 새 order 발급 → 진짜로 두 번 청구. payment_status 검사는 첫 결제가
    // DB 에 안 적힌 상태라 통과해 버려서 이 갈래를 못 막았다.
    //
    // PayPal-Request-Id 를 같은 값으로 보내면 PayPal 이 같은 주문을 돌려준다.
    // 그러면 재시도는 같은 order 를 다시 캡처하게 되고, capture 쪽의
    // ORDER_ALREADY_CAPTURED 멱등 처리로 안전하게 수렴한다.
    //
    // 시간 버킷(UTC 시각 단위)을 넣는 이유: 애드온은 원래 여러 번 살 수 있다.
    // 영구 고정하면 "같은 애드온을 나중에 한 번 더" 가 막힌다. 1시간이면 오조작
    // 재시도는 합쳐지고 의도적 재구매는 통과한다.
    const bucket = new Date().toISOString().slice(0, 13).replace(/[-:T]/g, '');
    const requestId = ['pap', kind, submissionId, addon || 'base', bucket].join('-').slice(0, 108);

    const r = await paypalFetch('/v2/checkout/orders', {
      method: 'POST',
      headers: { 'PayPal-Request-Id': requestId },
      body: JSON.stringify({
        // 🔴 2026-08-12 — 게재료 intent 는 "심사 전인가" 로 갈린다.
        //
        //   심사 전(pending·revision) → AUTHORIZE : 돈을 묶기만 한다. 승인되면
        //     capture(청구), 거절·보완·SLA초과면 void(무청구). 승인후결제의 본체.
        //
        //   이미 승인됨(approved)     → CAPTURE   : "지금 결제하기" 경로다.
        //     심사가 이미 끝났으므로 묶어둘 이유가 없고, 묶어두면 심사 시점이
        //     없어 영영 캡처되지 않는다. 기존 승인 66건이 여기 해당한다.
        //
        //   애드온                    → CAPTURE   : 게재 확정 후 사는 선택 상품.
        //
        // ⚠️ 이 분기를 kind 만으로 판단하면 승인된 건이 결제 불능이 된다
        //    (AUTHORIZE 주문을 capture 엔드포인트로 보내 실패). 2026-08-12 실측.
        intent: (kind === 'submission_fee' && String(sub.status) !== 'approved')
          ? 'AUTHORIZE' : 'CAPTURE',
        purchase_units: [{
          custom_id: buildCustomId(kind, submissionId, addon),
          description: amt.label.slice(0, 127),
          amount: { currency_code: 'EUR', value: centsToValue(amt.cents) },
        }],
        application_context: {
          brand_name: 'PAP MAGAZINE',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      }),
    });

    if (!r.ok) {
      console.error('[paypal-order] 생성 실패', r.status, JSON.stringify(r.body).slice(0, 300));
      return res.status(502).json({ message: 'Could not start payment. Please try again.' });
    }
    return res.status(200).json({ id: r.body.id });
  } catch (e) {
    console.error('[paypal-order] 예외:', e.message);
    return res.status(500).json({ message: 'Could not start payment.' });
  }
};
