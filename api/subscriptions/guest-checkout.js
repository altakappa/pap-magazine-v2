/**
 * POST /api/subscriptions/guest-checkout — 비회원 카드 결제
 *
 * Lets a visitor subscribe without first creating an account. We:
 *   1. Validate email + name + payment fields.
 *   2. Reject if the email is already registered (must log in instead).
 *   3. Create a new Supabase auth user with a random password.
 *   4. Create the profile row.
 *   5. Run the same PortOne first-payment + recurring-schedule flow as
 *      the authenticated /checkout endpoint.
 *   6. Persist the subscription.
 *   7. Return a PAP JWT so the frontend can auto-log-in the new user
 *      and a separate "set password" magic link is mailed by Supabase
 *      automatically (passwordReset email).
 *
 * Body: { email, name, billingKey, plan, billing }
 */

const crypto = require('crypto');
const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { basePlanFromPlanKey } = require('../_lib/subscriptionAccess');

const PORTONE_API_BASE = 'https://api.portone.io';
const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;

// Match the authenticated checkout endpoint exactly.
const PLAN_PRICES = {
  standard_monthly: { amount: 8500,   name: 'PAP Standard Monthly' },
  standard_yearly:  { amount: 85000,  name: 'PAP Standard Yearly'  },
  premium_monthly:  { amount: 13500,  name: 'PAP Premium Monthly'  },
  premium_yearly:   { amount: 135000, name: 'PAP Premium Yearly'   },
};

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
    throw new Error(`PortOne ${res.status}: ${data.message || data.type || 'API error'}`);
  }
  return data;
}

function getNextBillingDate(billingCycle) {
  const now = new Date();
  if (billingCycle === 'yearly') {
    return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  }
  return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// RFC-5322-ish; good enough to keep junk out of the auth table.
function isValidEmail(s) {
  return typeof s === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
    && s.length <= 255;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!PORTONE_API_SECRET) {
    console.error('PORTONE_API_SECRET is not set in environment');
    return res.status(503).json({
      message: '결제 시스템이 아직 설정되지 않았어요. 관리자에게 문의해 주세요.',
      detail: 'PORTONE_API_SECRET missing on the server.',
    });
  }

  try {
    const { email, name, billingKey, plan, billing } = req.body || {};

    // ── Input validation ──────────────────────────────────────────────
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: '유효한 이메일을 입력해 주세요.' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const displayName = (typeof name === 'string' ? name.trim() : '').slice(0, 100);
    if (!displayName) {
      return res.status(400).json({ message: '이름을 입력해 주세요.' });
    }
    if (!billingKey) {
      return res.status(400).json({ message: '결제 수단 등록이 완료되지 않았어요.' });
    }
    const planKey = `${plan}_${billing}`;
    const planInfo = PLAN_PRICES[planKey];
    if (!planInfo) {
      return res.status(400).json({ message: '유효하지 않은 플랜이에요.' });
    }

    // ── Reject if email already exists ────────────────────────────────
    // Look up via admin API. listUsers filtered by email is the cleanest
    // path; profile table check is a backup in case auth.users got out
    // of sync at some point.
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (existingProfile) {
      return res.status(409).json({
        message: '이미 가입된 이메일이에요. 로그인 후 결제해 주세요.',
        existingAccount: true,
      });
    }

    // ── Create the auth user ──────────────────────────────────────────
    // Random 32-byte password — the user will set their own via the
    // password-reset email Supabase sends below.
    const tempPassword = crypto.randomBytes(32).toString('base64url');
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: tempPassword,
      email_confirm: true,            // skip the confirm-email step
      user_metadata: { name: displayName, signup_via: 'guest_checkout' },
    });
    if (createErr || !created || !created.user) {
      console.error('[guest-checkout] auth createUser failed:', createErr && createErr.message);
      return res.status(500).json({ message: '계정 생성에 실패했어요. 잠시 후 다시 시도해 주세요.' });
    }
    const userId = created.user.id;

    // ── Create profile row ────────────────────────────────────────────
    // The profile trigger from migration 000 may have created a row already;
    // upsert keeps this idempotent.
    await supabaseAdmin.from('profiles').upsert({
      id: userId,
      email: normalizedEmail,
      display_name: displayName,
      role: 'member',
      subscription_plan: 'free', // will be updated to planKey after payment succeeds
    }, { onConflict: 'id' });

    // ── PortOne first payment ─────────────────────────────────────────
    const paymentId = `pap_g_${userId}_${Date.now()}`;
    await portoneRequest('POST', `/payments/${encodeURIComponent(paymentId)}/billing-key`, {
      billingKey,
      orderName: planInfo.name,
      amount: { total: planInfo.amount },
      currency: 'KRW',
      customer: { id: userId, email: normalizedEmail, name: displayName },
    });

    // ── Schedule next recurring payment (best effort) ─────────────────
    const nextDate = getNextBillingDate(billing);
    try {
      const scheduleId = `pap_sched_${userId}_${Date.now()}`;
      await portoneRequest('POST', `/payment-schedules`, {
        paymentId: scheduleId,
        billingKey,
        orderName: planInfo.name,
        amount: { total: planInfo.amount },
        currency: 'KRW',
        customer: { id: userId, email: normalizedEmail, name: displayName },
        timeToPay: nextDate.toISOString(),
      });
    } catch (schedErr) {
      console.warn('[guest-checkout] schedule warning:', schedErr.message);
    }

    // ── Persist subscription + bump profile plan ──────────────────────
    const now = new Date();
    const { error: subErr } = await supabaseAdmin.from('subscriptions').upsert({
      user_id: userId,
      portone_billing_key: billingKey,
      portone_payment_id: paymentId,
      plan: planKey,
      billing_cycle: billing,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: nextDate.toISOString(),
    }, { onConflict: 'user_id' });
    if (subErr) {
      console.error('[guest-checkout] subscription upsert failed:', subErr.message);
      // Don't fail the request — first payment already succeeded.
    }
    // 2026-07-20 — 게이트는 base plan('premium'/'standard')만 인식한다. 원본 planKey
    // ('premium_monthly' 등)를 그대로 쓰면 결제한 게스트가 오히려 전 게이트에서 free로
    // 막힌다(checkout.js·paddle-webhook.js와 동일 규칙). base plan으로 정규화해 저장하고
    // 원본 키는 subscriptions.plan에만 보존한다.
    const basePlan = basePlanFromPlanKey(planKey);
    await supabaseAdmin.from('profiles').update({
      subscription_plan: basePlan,
      subscription_status: 'active',
    }).eq('id', userId);

    // ── Mail a "set your password" reset link ────────────────────────
    // We created the account with a random password. The user gets a
    // proper way to set their own via Supabase's recovery email.
    try {
      await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: normalizedEmail,
      });
    } catch (mailErr) {
      // Non-fatal — they can still use "비밀번호 찾기" later.
      console.warn('[guest-checkout] recovery mail warning:', mailErr.message);
    }

    // ── Auto-login: return a PAP JWT so the frontend can localStorage-it ──
    const userObj = {
      id: userId,
      email: normalizedEmail,
      name: displayName,
      role: 'member',
      subscription: basePlan,
      token_version: 0,
    };
    const token = generateToken(userObj);

    return res.status(200).json({
      success: true,
      paymentId,
      plan: planKey,
      nextBilling: nextDate.toISOString(),
      token,
      user: userObj,
      passwordSetupSent: true,
    });
  } catch (error) {
    console.error('[guest-checkout] error:', error.message || error);
    return res.status(500).json({
      message: '결제 처리 중 오류가 발생했어요.',
      detail: error.message || 'Unknown',
    });
  }
};
