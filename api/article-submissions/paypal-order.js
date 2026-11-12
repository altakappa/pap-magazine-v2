/**
 * POST /api/article-submissions/paypal-order — 아티클 게재료(€790) 주문 생성
 *
 * body: { submission_id }
 * →     { id: '<PayPal order id>' }
 *
 * ■ intent 는 CAPTURE 다 (AUTHORIZE 가 아니다)
 * 에디토리얼은 **제출 시점**에 묶고(AUTHORIZE) 심사 통과 때 청구한다. 아티클은
 * 순서가 반대다 — 도메니코가 심사에서 '홍보성' 으로 판정한 뒤에야 €790 이
 * 생긴다(도메니코 결정 2026-11-12: 심사 후 통보). 즉 **심사가 이미 끝난 뒤의
 * 결제**다. 그래서 묶을 이유가 없다.
 *
 * 묶으면 오히려 깨진다: PayPal Honor Period 는 72시간이고, 그 안에 캡처할
 * '심사 시점' 이 이 흐름에는 없다. 에디토리얼 코드도 같은 이유로 이미 승인된
 * 건은 CAPTURE 로 분기한다(api/submissions/paypal-order.js 의 intent 주석).
 *
 * ■ 금액은 서버가 정한다
 * 브라우저는 "어느 기고" 만 말하고 "얼마" 는 말하지 못한다. 금액의 근거는
 * article_submissions.fee_type 이고, 그 칸은 관리자 엔드포인트만 쓸 수 있다.
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

  /* 결제 경로는 strict 로 — requireAuth 는 DB 를 안 봐서 로그아웃 뒤에도 옛
     토큰이 먹는다. 돈이 걸린 곳은 매 요청 token_version 을 대조한다
     (2026-09-04 보안감사 2군 C, 에디토리얼 결제 경로와 같은 규칙). */
  const user = await requireAuthStrict(req, res);
  if (!user) return;

  if (process.env.PAYMENTS_PAUSED === '1') {
    return res.status(200).json({ paused: true, contactEmail: 'contact@pap-magazine.com' });
  }
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ message: 'Payment not configured.' });
  }

  const submissionId = String((req.body || {}).submission_id || '');
  if (!submissionId) return res.status(400).json({ message: 'submission_id required' });

  try {
    const { data: sub, error } = await supabaseAdmin
      .from('article_submissions')
      .select('id, user_id, title, status, fee_type, payment_status')
      .eq('id', submissionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) return res.status(404).json({ code: 'not_found', message: 'Submission not found' });

    // 남의 기고를 결제하게 두면 결제 성공이 남의 payment_status 를 뒤집는다.
    if (String(sub.user_id) !== String(user.id)) {
      return res.status(403).json({ code: 'not_owner', message: 'Not your submission' });
    }
    if (String(sub.payment_status) === 'paid') {
      return res.status(409).json({ code: 'already_paid', message: 'Already paid' });
    }
    if (String(sub.payment_status) === 'waived') {
      return res.status(409).json({ code: 'already_waived', message: 'No fee is due for this submission' });
    }
    // 거절·철회된 건은 결제 대상이 아니다. 받아 두면 환불 대화가 된다.
    if (String(sub.status) === 'rejected' || String(sub.status) === 'withdrawn') {
      return res.status(409).json({ code: 'not_payable', message: 'This submission is not awaiting payment' });
    }

    const amt = resolveAmount(sub, 'article_fee', null);
    if (amt.error) return res.status(400).json({ code: amt.error, message: 'Cannot price this item' });

    /* 서버측 멱등키 — 같은 건의 재시도가 새 주문을 만들지 않게 한다.
       사고 경로(2026-08-12 에디토리얼): 캡처는 됐는데 우리 반영이 실패 →
       회원이 "다시 시도" → 새 order → 진짜로 두 번 청구. 같은 PayPal-Request-Id
       를 보내면 PayPal 이 같은 주문을 돌려주고, 캡처 쪽 멱등 처리로 수렴한다.
       시간 버킷(1시간)을 넣어 오조작 재시도는 합치고 진짜 재결제는 통과시킨다. */
    const bucket = new Date().toISOString().slice(0, 13).replace(/[-:T]/g, '');
    const requestId = ['pap', 'articlefee', submissionId, bucket].join('-').slice(0, 108);

    const r = await paypalFetch('/v2/checkout/orders', {
      method: 'POST',
      headers: { 'PayPal-Request-Id': requestId },
      body: JSON.stringify({
        intent: 'CAPTURE',   // 위 주석 — 심사가 이미 끝난 뒤의 결제다
        purchase_units: [{
          custom_id: buildCustomId('article_fee', submissionId, null),
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
      console.error('[article paypal-order] 생성 실패', r.status, JSON.stringify(r.body).slice(0, 300));
      return res.status(502).json({ code: 'order_failed', message: 'Could not start payment. Please try again.' });
    }
    return res.status(200).json({ id: r.body.id });
  } catch (e) {
    console.error('[article paypal-order] 예외:', e && e.message);
    return res.status(500).json({ code: 'order_failed', message: 'Could not start payment.' });
  }
};
