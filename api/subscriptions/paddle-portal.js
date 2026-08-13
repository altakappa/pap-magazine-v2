/**
 * POST /api/subscriptions/paddle-portal — 해외(Paddle) 구독 해지
 *
 * body: { action: 'cancel' }
 *   → Paddle API 로 구독 해지 (effective_from: next_billing_period —
 *     이미 결제한 기간이 끝날 때 해지. 국내 포탈과 동일한 정책).
 *   실제 상태 반영은 paddle-webhook (subscription.updated/canceled) 이 담당.
 *
 * 🔴 2026-08-14 Paddle 폐쇄 이후에는 Paddle 을 부르지 않는다 — 아래 paddleIsGone()
 *   분기 참조. 청구 주체가 사라졌으므로 '해지 실패' 가 아니라 '이미 갱신 불가' 다.
 */

const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { paddleIsGone } = require('../_lib/cancelProviderSubscription');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

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

  const action = (req.body && req.body.action) || 'cancel';
  if (action !== 'cancel') {
    return res.status(400).json({ message: 'Unsupported action' });
  }

  try {
    const { data: row } = await supabaseAdmin
      .from('subscriptions')
      .select('paddle_subscription_id, status, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!row || !row.paddle_subscription_id) {
      return res.status(404).json({ message: 'No international subscription found.' });
    }
    if (row.status === 'canceled') {
      return res.status(400).json({ message: 'Subscription already canceled.' });
    }

    /* 🔴 2026-08-13 — Paddle 폐쇄 이후에는 Paddle 을 부르지 않는다.
     *   부르면 실패하고, 프론트는 '해지 실패' 를 띄운다. 그런데 사실은 반대다:
     *   청구 주체가 사라져 **이미 갱신이 불가능하다.** 해지할 필요가 없는데
     *   실패했다고 말하면 그 사람은 돈이 계속 나간다고 믿고 카드사·PayPal 분쟁을
     *   건다. Paddle 을 막 잃은 지금 결제 계정을 하나 더 잃는 길이다.
     *   그래서 사실대로 처리한다 — DB 를 canceled 로 내리고 200 을 돌려준다.
     *   이미 낸 기간(current_period_end)은 건드리지 않는다. 그 뒤 등급을 내리는
     *   것은 subscription-expiry-sweep 이 한다('canceled' 도 훑는다). */
    if (paddleIsGone()) {
      const { error: upErr } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      if (upErr) {
        console.error('[paddle-portal] shutdown cancel db failed:', upErr.message);
        return res.status(500).json({ message: 'Failed to cancel subscription.' });
      }
      // 알림은 반드시 await 한다 — 서버리스는 응답 반환 후 함수를 얼린다(6a13439).
      await sendTextToTelegramSafe('🔻 Paddle 구독 해지 요청 (폐쇄 후 처리)\n'
        + 'user=' + user.id + '\n'
        + '남은 기간: ' + (row.current_period_end || '알 수 없음') + '\n'
        + 'Paddle 은 이미 청구 불가 — DB 만 canceled 로 내렸다. 환불은 발생하지 않는다.');
      return res.status(200).json({
        success: true,
        shutdown: true,
        message: 'Subscription will not renew. Access continues until the end of the paid period.',
        effective_at: row.current_period_end || null,
      });
    }

    if (!PADDLE_API_KEY) {
      return res.status(503).json({ message: 'International payment not yet configured.' });
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
