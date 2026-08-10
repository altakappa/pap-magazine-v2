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

const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { paypalFetch, resolveAmount, centsToValue, buildCustomId } = require('../_lib/paypalOrders');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
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
      .select('id, user_id, title, description, payment_status')
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

    const amt = resolveAmount(sub, kind, addon);
    if (amt.error) return res.status(400).json({ code: amt.error, message: 'Cannot price this item' });

    const r = await paypalFetch('/v2/checkout/orders', {
      method: 'POST',
      body: JSON.stringify({
        intent: 'CAPTURE',
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
