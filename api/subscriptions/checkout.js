/**
 * POST /api/subscriptions/checkout — Issue PortOne billing key & create subscription
 *
 * PortOne V2 flow:
 *   1. Frontend calls PortOne.requestIssueBillingKey() → gets billingKey
 *   2. Frontend POSTs billingKey + plan + billing to this endpoint
 *   3. Server stores billingKey, creates first payment via PortOne API
 *   4. Server schedules next recurring payment
 *   5. Returns success status
 */

const { requireAuthStrict } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

// PortOne V2 API base
const PORTONE_API_BASE = 'https://api.portone.io';
const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;

// Plan pricing (in KRW — base currency; frontend handles display currency)
const PLAN_PRICES = {
  standard_monthly:  { amount: 8500,  name: 'PAP Standard Monthly' },
  standard_yearly:   { amount: 85000, name: 'PAP Standard Yearly' },
  premium_monthly:   { amount: 13500, name: 'PAP Premium Monthly' },
  premium_yearly:    { amount: 135000, name: 'PAP Premium Yearly' },
};

// Helper: call PortOne V2 REST API
async function portoneRequest(method, path, body) {
  const res = await fetch(`${PORTONE_API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `PortOne ${PORTONE_API_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    const errMsg = data.message || data.type || 'PortOne API error';
    throw new Error(`PortOne ${res.status}: ${errMsg}`);
  }
  return data;
}

// Calculate next billing date
function getNextBillingDate(billingCycle) {
  const now = new Date();
  if (billingCycle === 'yearly') {
    return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  }
  // monthly
  return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (rateLimit(req, res, RATE_LIMITS.auth)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  /* 2026-09-04 보안감사 (2군 C) — 결제 경로는 strict 로. requireAuth 는 DB 를 안 봐서
     로그아웃(token_version 증가) 뒤에도 옛 토큰이 7일간 먹는다. 돈이 걸린 곳은 매 요청
     DB 에서 token_version·role 을 대조한다(auth.js:110 주석의 원칙과 일치). */
  const user = await requireAuthStrict(req, res);
  if (!user) return;

  // Surface a clear error if PortOne credentials weren't configured on Vercel.
  // Without this check the request silently 500s with a generic "Failed to
  // process payment" message, which is nearly impossible to diagnose from
  // the user's side.
  if (!PORTONE_API_SECRET) {
    console.error('PORTONE_API_SECRET is not set in environment');
    return res.status(503).json({
      message: 'Payment system not yet configured. Please contact support.',
      detail: 'PORTONE_API_SECRET missing on the server.',
    });
  }

  try {
    const { billingKey, plan, billing } = req.body;
    // billingKey: from PortOne.requestIssueBillingKey() on frontend
    // plan: 'standard' or 'premium'
    // billing: 'monthly' or 'yearly'

    if (!billingKey) {
      return res.status(400).json({ message: 'Billing key is required' });
    }

    const planKey = `${plan}_${billing}`;
    const planInfo = PLAN_PRICES[planKey];

    if (!planInfo) {
      return res.status(400).json({ message: 'Invalid plan or billing cycle' });
    }

    // 게이트(isPremium/isStandardOrAbove)는 base plan('premium'/'standard')만 본다.
    // planKey('standard_monthly')를 그대로 profiles에 쓰면 결제 회원이 막힌다
    // (paddle-webhook.js와 동일 규칙 — 원본 키는 subscriptions.plan에 보존).
    const basePlan = /^premium/.test(planKey) ? 'premium'
      : /^standard/.test(planKey) ? 'standard' : 'free';
    const now = new Date();

    // ── 7일 무료 체험 ─────────────────────────────────────────────
    // 첫 구독자(구독 이력 없음)만 대상. 즉시 청구 대신 첫 결제를 7일 뒤로 예약하고
    // status='trialing'로 접근을 부여한다. 7일 뒤 예약결제가 성사되면
    // portone-webhook(PaymentSchedule.Paid)이 status='active'로 올리고 다음 결제를
    // 재예약하므로 정기결제가 자연히 이어진다.
    let wantTrial = req.body.trial === true;
    if (wantTrial) {
      const { data: _existing } = await supabaseAdmin
        .from('subscriptions').select('id').eq('user_id', user.id).maybeSingle();
      if (_existing) wantTrial = false; // 이미 구독 이력 → 재체험 방지
    }
    if (wantTrial) {
      const TRIAL_DAYS = 7;
      const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      const trialSchedId = `pap_sched_${user.id}_${Date.now()}`;
      // 첫 결제(=체험 종료일) 예약. 즉시 청구 없음.
      await portoneRequest('POST', `/payment-schedules`, {
        paymentId: trialSchedId,
        billingKey,
        orderName: planInfo.name,
        amount: { total: planInfo.amount },
        currency: 'KRW',
        customer: { id: user.id, email: user.email },
        timeToPay: trialEnd.toISOString(),
      });
      const { error: trialErr } = await supabaseAdmin.from('subscriptions').upsert({
        user_id: user.id,
        portone_billing_key: billingKey,
        portone_payment_id: trialSchedId,
        plan: planKey,
        billing_cycle: billing,
        status: 'trialing',
        current_period_start: now.toISOString(),
        current_period_end: trialEnd.toISOString(),
      }, { onConflict: 'user_id' });
      if (trialErr) console.error('Trial subscription upsert failed:', trialErr.message || trialErr);
      // 체험 중에도 접근 부여 — 게이트는 base plan만 본다.
      await supabaseAdmin.from('profiles').update({
        subscription_plan: basePlan,
        subscription_status: 'active',
      }).eq('id', user.id);
      return res.status(200).json({
        success: true,
        trial: true,
        plan: planKey,
        trialEnd: trialEnd.toISOString(),
        nextBilling: trialEnd.toISOString(),
      });
    }

    // Generate unique payment ID
    const paymentId = `pap_${user.id}_${Date.now()}`;

    // 1. Request first payment using billing key
    const payment = await portoneRequest('POST', `/payments/${encodeURIComponent(paymentId)}/billing-key`, {
      billingKey,
      orderName: planInfo.name,
      amount: {
        total: planInfo.amount,
      },
      currency: 'KRW',
      customer: {
        id: user.id,
        email: user.email,
      },
    });

    // 2. Schedule next recurring payment
    const nextDate = getNextBillingDate(billing);
    const scheduleId = `pap_sched_${user.id}_${Date.now()}`;

    try {
      await portoneRequest('POST', `/payment-schedules`, {
        paymentId: scheduleId,
        billingKey,
        orderName: planInfo.name,
        amount: {
          total: planInfo.amount,
        },
        currency: 'KRW',
        customer: {
          id: user.id,
          email: user.email,
        },
        timeToPay: nextDate.toISOString(),
      });
    } catch (schedErr) {
      console.warn('Schedule creation warning:', schedErr.message);
      // First payment succeeded, schedule can be retried
    }

    // 3. Store subscription in Supabase. We use the existing `subscriptions`
    //    table (extended in migration 007 with portone_* columns) rather than
    //    a parallel `subscribers` table — keeps a single source of truth.
    const { error: subErr } = await supabaseAdmin.from('subscriptions').upsert({
      user_id: user.id,
      portone_billing_key: billingKey,
      portone_payment_id: paymentId,
      plan: planKey,
      billing_cycle: billing,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: nextDate.toISOString(),
    }, { onConflict: 'user_id' });
    if (subErr) {
      // Don't fail the request — first payment already succeeded. Log loudly
      // so we can reconcile later from PortOne logs.
      console.error('Subscription row upsert failed:', subErr.message || subErr);
    }

    // 4. Update user profile so `_user.subscription` reflects the new tier
    //    immediately on next login. Also bump token_version so any active
    //    JWTs are forced to refresh (prevents stale free-tier flags).
    await supabaseAdmin.from('profiles').update({
      subscription_plan: basePlan,
      subscription_status: 'active',
    }).eq('id', user.id);

    return res.status(200).json({
      success: true,
      paymentId,
      plan: planKey,
      nextBilling: nextDate.toISOString(),
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ message: 'Failed to process payment' });
  }
};
