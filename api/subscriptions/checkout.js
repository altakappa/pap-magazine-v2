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

const { requireAuth } = require('../_lib/auth');
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

  const user = requireAuth(req, res);
  if (!user) return;

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

    // 3. Store subscription in Supabase
    const now = new Date();
    await supabaseAdmin.from('subscribers').upsert({
      user_id: user.id,
      portone_billing_key: billingKey,
      portone_payment_id: paymentId,
      plan: planKey,
      billing_cycle: billing,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: nextDate.toISOString(),
    }, { onConflict: 'user_id' });

    // 4. Update user profile
    await supabaseAdmin.from('profiles').update({
      subscription_plan: planKey,
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
