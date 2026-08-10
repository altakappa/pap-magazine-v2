/**
 * POST /api/subscriptions/paypal-portal — 해외(PayPal) 구독 해지
 *
 * body: { action: 'cancel' }
 *   → PayPal API 로 구독 해지. PayPal 의 구독 해지는 "즉시 해지"지만
 *     billing_info.next_billing_time 까지는 이미 결제된 기간이므로,
 *     접근권은 subscriptions.current_period_end 로 계속 보장된다.
 *     (paddle-portal 의 next_billing_period 정책과 실질 동일)
 *
 *   상태 반영은 BILLING.SUBSCRIPTION.CANCELLED 웹훅이 담당한다.
 *   여기서 profiles 를 직접 강등하지 않는다 — 2026-08-07 lia.line 사고에서
 *   배운 대로, 강등 판정은 웹훅 한 곳에만 둔다.
 *
 * ⚠️ 이 저장소에는 paddle-portal.js 도 살아 있다. 8/14 폐쇄 전까지 기존
 *    Paddle 구독자가 해지할 수 있어야 하기 때문이다. 이 엔드포인트는
 *    PayPal 구독만 처리하고, 아니면 409 { code:'not_paypal' } 을 돌려
 *    프론트가 paddle-portal 로 폴백하게 한다.
 */

const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API_BASE = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error('PayPal token failed');
  return j.access_token;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ message: 'International payment not yet configured.' });
  }

  const action = (req.body && req.body.action) || 'cancel';
  if (action !== 'cancel') return res.status(400).json({ message: 'Unsupported action' });

  try {
    const { data: row, error } = await supabaseAdmin
      .from('subscriptions')
      .select('paypal_subscription_id, provider, status, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row || !row.paypal_subscription_id) {
      // Paddle 시절 구독이거나 구독 자체가 없음 → 프론트가 paddle-portal 로 폴백.
      return res.status(409).json({ code: 'not_paypal', message: 'No PayPal subscription for this account.' });
    }
    if (String(row.status) === 'canceled') {
      return res.status(200).json({ ok: true, alreadyCanceled: true, accessUntil: row.current_period_end });
    }

    const token = await getAccessToken();
    const r = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${row.paypal_subscription_id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled by subscriber from PAP MAGAZINE' }),
    });

    // 204 = 성공(본문 없음). 422 로 "이미 해지됨"이 오는 경우도 성공으로 본다.
    if (r.status === 204) {
      return res.status(200).json({ ok: true, accessUntil: row.current_period_end });
    }
    const j = await r.json().catch(() => ({}));
    const alreadyDone = r.status === 422
      && JSON.stringify(j).indexOf('SUBSCRIPTION_STATUS_INVALID') !== -1;
    if (alreadyDone) {
      return res.status(200).json({ ok: true, alreadyCanceled: true, accessUntil: row.current_period_end });
    }
    console.error('[paypal-portal] cancel 실패', r.status, JSON.stringify(j).slice(0, 300));
    return res.status(502).json({ message: 'Cancellation failed. Please contact support.' });
  } catch (e) {
    console.error('[paypal-portal] 예외:', e.message);
    return res.status(500).json({ message: 'Cancellation failed. Please contact support.' });
  }
};
