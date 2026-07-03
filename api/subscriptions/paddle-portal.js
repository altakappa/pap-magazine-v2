/**
 * POST /api/subscriptions/paddle-portal — 해외(Paddle) 구독 해지
 *
 * body: { action: 'cancel' }
 *   → Paddle API 로 구독 해지 (effective_from: next_billing_period —
 *     이미 결제한 기간이 끝날 때 해지. 국내 포탈과 동일한 정책).
 *   실제 상태 반영은 paddle-webhook (subscription.updated/canceled) 이 담당.
 */

const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_API_BASE = process.env.PADDLE_ENV === 'production'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (!PADDLE_API_KEY) {
    return res.status(503).json({ message: 'International payment not yet configured.' });
  }

  const action = (req.body && req.body.action) || 'cancel';
  if (action !== 'cancel') {
    return res.status(400).json({ message: 'Unsupported action' });
  }

  try {
    const { data: row } = await supabaseAdmin
      .from('subscriptions')
      .select('paddle_subscription_id, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!row || !row.paddle_subscription_id) {
      return res.status(404).json({ message: 'No international subscription found.' });
    }
    if (row.status === 'canceled') {
      return res.status(400).json({ message: 'Subscription already canceled.' });
    }

    const resp = await fetch(`${PADDLE_API_BASE}/subscriptions/${encodeURIComponent(row.paddle_subscription_id)}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ effective_from: 'next_billing_period' }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      const detail = (json.error && json.error.detail) || 'Paddle API error';
      console.error('[paddle-portal] cancel failed:', detail);
      return res.status(502).json({ message: 'Failed to cancel subscription. Please contact support.', detail });
    }

    // 낙관적 표시용 — 확정 상태는 웹훅이 갱신.
    const endsAt = json.data && json.data.scheduled_change && json.data.scheduled_change.effective_at;
    return res.status(200).json({
      success: true,
      message: 'Subscription will end at the current billing period.',
      effective_at: endsAt || null,
    });
  } catch (error) {
    console.error('[paddle-portal] error:', error);
    return res.status(500).json({ message: 'Failed to cancel subscription.' });
  }
};
