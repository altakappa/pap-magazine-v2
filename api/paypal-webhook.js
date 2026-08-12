/**
 * POST /api/paypal-webhook — PayPal 구독 웹훅 처리
 *
 * 2026-08-10 · Paddle(MoR) 계정 폐쇄(8/14) → PayPal 전환.
 *
 * ── Paddle 과 무엇이 다른가 ────────────────────────────────────────
 *  · PayPal 은 MoR 이 아니다. 세금을 대신 걷어주지 않는다. 표시가가
 *    "세금 포함 최종가"이고 세금은 회사가 부담한다(2026-08-10 도메니코 결정).
 *  · 통화는 EUR 하나. KRW 는 PayPal 지원 통화에 없다(실측 확인).
 *  · 무료 체험 없음 — trialing 상태가 존재하지 않는다.
 *  · 서명 검증이 HMAC 이 아니라 PayPal 서버 왕복(verify-webhook-signature)이다.
 *
 * 처리 이벤트:
 *   BILLING.SUBSCRIPTION.ACTIVATED        — 구독 활성 (첫 결제 완료)
 *   BILLING.SUBSCRIPTION.UPDATED          — 플랜/상태 변경
 *   BILLING.SUBSCRIPTION.CANCELLED        — 해지 확정
 *   BILLING.SUBSCRIPTION.SUSPENDED        — 일시정지
 *   BILLING.SUBSCRIPTION.EXPIRED          — 만료
 *   BILLING.SUBSCRIPTION.PAYMENT.FAILED   — 결제 실패 → past_due
 *   PAYMENT.SALE.COMPLETED                — 갱신 결제(기간 연장)
 *   PAYMENT.CAPTURE.COMPLETED             — 서브미션 게재료·애드온 결제 확정 (복구 그물)
 *   PAYMENT.CAPTURE.REFUNDED / .REVERSED  — 환불·역전 → payment_status 되돌림
 *   CUSTOMER.DISPUTE.CREATED              — 분쟁 발생 알림
 *
 * ── 🔴 2026-08-12 — Orders(일회성 결제) 이벤트를 받는 이유 ────────────
 *   구독은 웹훅이 500 을 던지면 PayPal 이 재시도해 자동 복구된다. 그런데
 *   서브미션 게재료(€380/€790)는 브라우저→서버 왕복 한 번(paypal-capture.js)이
 *   전부였다. 그 한 번이 실패하면 돈은 받았는데 DB 는 안 바뀌고, 되돌릴 방법이
 *   없었다. PAYMENT.CAPTURE.COMPLETED 하나를 받는 것만으로 그 갈래가 전부
 *   자동 복구된다. 가장 값싼 안전장치다.
 *
 *   환불도 마찬가지다. PayPal 대시보드에서 직접 환불하면 우리 DB 의
 *   payment_status 는 영원히 'paid' 로 남아, 환불된 건이 게재 대기열에 계속 선다.
 *
 * ⚠️ 2026-08-07 사고에서 얻은 규칙 (반드시 유지)
 *   lia.line 님이 2분 간격으로 구독을 2건 만들어 €8.99 를 두 번 냈다. 중복분을
 *   해지하자 웹훅이 **회원 단위로** 강등해, 9/7 까지 유효한 멀쩡한 구독이 있는데도
 *   Premium 접근이 즉시 끊겼다.
 *   → 강등은 "이 취소 이벤트가 우리가 지금 들고 있는 그 구독일 때"만 한다.
 *     저장된 paypal_subscription_id 와 다르면 손대지 않는다.
 *   (subscriptions 는 user_id UNIQUE 라 회원당 1행이다. 그래서 '다른 활성 구독이
 *    있는지'를 이 대조로 판정한다.)
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { sendTextToTelegramSafe } = require('./_lib/telegram');
const { downgradeToFree } = require('./_lib/subscriptionAccess');
const { handleCaptureCompleted, handleCaptureRefunded } = require('./_lib/paypalCaptureRecovery');

const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API_BASE = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

// Raw body 가 필요하다 — 서명 검증에 원문이 들어간다.
module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── PayPal API ────────────────────────────────────────────────────
let _tokenCache = { value: null, expiresAt: 0 };

async function getAccessToken() {
  const now = Date.now();
  if (_tokenCache.value && now < _tokenCache.expiresAt) return _tokenCache.value;
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error('PayPal token failed: ' + JSON.stringify(j));
  // 만료 60초 전에 새로 받는다 (경계에서 401 나는 것 방지).
  _tokenCache = { value: j.access_token, expiresAt: now + Math.max(0, (j.expires_in || 300) - 60) * 1000 };
  return _tokenCache.value;
}

/**
 * 서명 검증 — PayPal 서버에 물어본다(HMAC 자체 계산이 아님).
 * cert_url 은 PayPal 이 준 값을 그대로 넘기되, 도메인이 paypal.com 인지 먼저 본다.
 * 위조 웹훅이 자기 인증서 URL 을 끼워 넣는 경로를 막는다.
 */
async function verifySignature(headers, eventObj) {
  if (!PAYPAL_WEBHOOK_ID || !PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return false;

  const certUrl = headers['paypal-cert-url'];
  try {
    const host = new URL(String(certUrl)).hostname;
    if (!/(^|\.)paypal\.com$/i.test(host)) {
      console.error('[paypal-webhook] cert_url 이 paypal.com 이 아님:', certUrl);
      return false;
    }
  } catch (_) { return false; }

  const body = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: certUrl,
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: eventObj,
  };
  if (!body.auth_algo || !body.transmission_id || !body.transmission_sig || !body.transmission_time) {
    return false;
  }

  const token = await getAccessToken();
  const r = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[paypal-webhook] verify 호출 실패', r.status, JSON.stringify(j).slice(0, 300));
    return false;
  }
  return j.verification_status === 'SUCCESS';
}

async function paypalGet(path) {
  const token = await getAccessToken();
  const r = await fetch(`${PAYPAL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal ${r.status} ${path}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// ── 매핑 ──────────────────────────────────────────────────────────
/** PayPal plan id(P-…) → 내부 plan key. 등급은 이 값으로만 결정한다. */
function planFromPlanId(planId) {
  if (!planId) return null;
  let map = {};
  try { map = JSON.parse(process.env.PAYPAL_PLANS_JSON || '{}') || {}; } catch (_) { return null; }
  for (const key of Object.keys(map)) {
    if (map[key] === planId) return key;
  }
  return null;
}

/** PayPal 구독 상태 → 내부 상태 */
function mapStatus(s) {
  switch (String(s || '').toUpperCase()) {
    case 'ACTIVE':            return 'active';
    case 'SUSPENDED':         return 'paused';
    case 'CANCELLED':         return 'canceled';
    case 'EXPIRED':           return 'canceled';
    case 'APPROVAL_PENDING':
    case 'APPROVED':          return 'pending';
    default:                  return 'pending';
  }
}

/**
 * user_id 해석.
 * custom_id 는 체크아웃 때 우리가 심는 값이라 위조 가능성이 있다.
 * 결제자 이메일로 해석한 유저와 대조해, 어긋나면 이메일 쪽을 신뢰하고 알린다.
 * (paddle-webhook 의 2026-07-20 감사 교정과 같은 규칙)
 */
async function resolveUserId(sub) {
  const claimed = (sub && sub.custom_id) || null;

  let emailUserId = null;
  const email = sub && sub.subscriber && sub.subscriber.email_address;
  if (email) {
    const { data: p } = await supabaseAdmin
      .from('profiles').select('id').ilike('email', email).maybeSingle();
    if (p) emailUserId = p.id;
  }

  if (claimed && emailUserId && claimed !== emailUserId) {
    console.error('[paypal-webhook] user_id MISMATCH custom:', claimed, 'email:', emailUserId, 'sub:', sub.id);
    sendTextToTelegramSafe('🚨 PayPal 구독 user_id 불일치 — 결제자 이메일 기준 배정. custom=' + claimed + ' email=' + emailUserId + ' sub=' + sub.id);
    return emailUserId;
  }
  if (claimed) {
    const { data: p } = await supabaseAdmin.from('profiles').select('id').eq('id', claimed).maybeSingle();
    if (p) return claimed;
    console.warn('[paypal-webhook] custom_id 가 실제 프로필이 아님:', claimed, '→ 이메일 폴백');
  }
  return emailUserId;
}

// ── 저장 ──────────────────────────────────────────────────────────
async function upsertSubscription(sub, userId) {
  const planKey = planFromPlanId(sub.plan_id);
  if (!planKey) {
    // 등급을 추측하지 않는다. 모르는 플랜은 저장은 하되 등급은 올리지 않는다.
    console.error('[paypal-webhook] 알 수 없는 plan_id:', sub.plan_id, '— PAYPAL_PLANS_JSON 확인 필요');
    sendTextToTelegramSafe('⚠️ PayPal 알 수 없는 plan_id=' + sub.plan_id + ' sub=' + sub.id + ' (PAYPAL_PLANS_JSON 확인)');
  }
  const plan = planKey || 'unknown';
  const status = mapStatus(sub.status);
  const bi = sub.billing_info || {};

  const { error } = await supabaseAdmin.from('subscriptions').upsert({
    user_id: userId,
    provider: 'paypal',
    currency: 'EUR',
    paypal_subscription_id: sub.id,
    plan,
    billing_cycle: /yearly$/.test(plan) ? 'yearly' : 'monthly',
    status,
    current_period_start: (bi.last_payment && bi.last_payment.time) || sub.start_time || null,
    current_period_end: bi.next_billing_time || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  // 저장 실패를 삼키고 200 을 주면 PayPal 이 재시도하지 않아 유료 구독이 유실된다.
  // throw → 500 → PayPal 재시도(멱등 upsert 이므로 안전).
  if (error) {
    console.error('[paypal-webhook] subscription upsert 실패:', error.message);
    throw new Error('subscription upsert failed: ' + error.message);
  }

  // profiles 에는 기본 등급만. 게이트가 'premium'/'standard' 등가 비교를 하므로
  // 'premium_monthly' 같은 원본 키를 쓰면 실결제 회원이 막힌다(2026-07-11 사고).
  const basePlan = /^premium/i.test(plan) ? 'premium' : /^standard/i.test(plan) ? 'standard' : null;
  const profileUpdate = { subscription_status: status === 'active' ? 'active' : 'inactive' };
  if (basePlan) profileUpdate.subscription_plan = basePlan;

  const { error: profErr } = await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', userId);
  if (profErr) {
    console.error('[paypal-webhook] profile update 실패:', profErr.message);
    throw new Error('profile update failed: ' + profErr.message);
  }
  return { plan, status };
}

/**
 * 해지/정지/만료 처리.
 * ⚠️ 강등 전에 "이 이벤트가 우리가 들고 있는 그 구독인지"를 반드시 대조한다.
 *    (2026-08-07 lia.line 사고 재발 방지 — 상세는 파일 상단 주석)
 */
async function handleTermination(sub, userId, eventType) {
  const { data: row } = await supabaseAdmin
    .from('subscriptions')
    .select('paypal_subscription_id, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  if (row && row.paypal_subscription_id && row.paypal_subscription_id !== sub.id) {
    console.warn('[paypal-webhook] 다른 구독의 종료 이벤트 — 강등하지 않음.',
      'event_sub:', sub.id, 'stored_sub:', row.paypal_subscription_id, 'user:', userId);
    sendTextToTelegramSafe('ℹ️ PayPal ' + eventType + ' — 회원의 활성 구독이 따로 있어 강등하지 않음. event=' + sub.id + ' stored=' + row.paypal_subscription_id);
    return { skipped: 'other_active_subscription' };
  }

  const status = mapStatus(sub.status);
  const { error } = await supabaseAdmin.from('subscriptions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw new Error('subscription status update failed: ' + error.message);

  // ⚠️ 2026-08-10 — 해지했다고 접근권을 그 자리에서 끊지 않는다.
  //    우리는 세 곳에서 정반대를 약속했다:
  //      · refund.html 약관 "해지 후에도 해당 결제 기간이 종료될 때까지 이용 가능"
  //      · 마이페이지 해지 확인창 "이미 결제하신 기간이 끝날 때까지 그대로 이용"
  //      · paypal-portal.js 주석
  //    그런데 코드는 즉시 강등하고 있었다(Paddle 시절부터의 동작을 그대로 옮겨옴).
  //    실측으로 발견: 9/10 까지 결제된 구독을 해지하자 그 순간 게이트가 막혔다.
  //    남은 기간의 강등은 만료 스윕(api/cron/subscription-expiry-sweep.js)이 맡는다.
  //
  //    EXPIRED 는 "기간이 끝났다"는 뜻이므로 예외 — 즉시 강등한다.
  const periodEnd = (row && row.current_period_end)
    || ((sub.billing_info || {}).next_billing_time) || null;
  const stillWithinPaidPeriod =
    eventType !== 'BILLING.SUBSCRIPTION.EXPIRED'
    && periodEnd
    && new Date(periodEnd).getTime() > Date.now();

  if (stillWithinPaidPeriod) {
    console.log('[paypal-webhook]', eventType, '— 결제한 기간이 남아 접근권 유지. user:', userId, 'until:', periodEnd);
    return { status, accessKeptUntil: periodEnd };
  }

  // 🔴 2026-08-12 — plan 까지 free 로 내린다.
  //   예전에는 subscription_status 만 'inactive' 로 바꿨다. 서버 게이트는 status 도
  //   보므로 유료 API 는 정상 차단되지만, **프론트 게이트는 plan 만 본다**
  //   (frontend/pap-subscription.js:37, pap-api.js:1016 · api/auth/me.js 는 plan 만 내려준다).
  //   그래서 해지·만료된 회원 화면에는 계속 PREMIUM 이 떠 있고, 콘텐츠를 열면
  //   서버가 403 을 준다. "돈 냈는데 안 열린다" 는 문의와 환불 요구로 돌아온다.
  //   Paddle 경로(api/paddle-webhook.js)는 처음부터 둘 다 내리고 있었다.
  const { error: profErr } = await downgradeToFree(supabaseAdmin, userId);
  if (profErr) throw new Error('profile downgrade failed: ' + profErr.message);

  return { status, downgraded: true };
}

// ── 핸들러 ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!PAYPAL_WEBHOOK_ID) {
    console.error('[paypal-webhook] PAYPAL_WEBHOOK_ID 미설정');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  const rawBody = await getRawBody(req);
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch (_) { return res.status(400).json({ error: 'Invalid JSON' }); }

  let ok = false;
  try { ok = await verifySignature(req.headers, event); }
  catch (e) { console.error('[paypal-webhook] 서명 검증 예외:', e.message); }
  if (!ok) {
    console.error('[paypal-webhook] 서명 검증 실패 — event:', event && event.event_type);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const type = event.event_type;
  const resource = event.resource || {};

  try {
    switch (type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.UPDATED': {
        // 이벤트 payload 를 그대로 믿지 않고 PayPal 원본을 다시 읽는다.
        let sub = resource;
        if (resource.id) {
          try { sub = await paypalGet(`/v1/billing/subscriptions/${resource.id}`); }
          catch (e) { console.warn('[paypal-webhook] 구독 재조회 실패, payload 사용:', e.message); }
        }
        const userId = await resolveUserId(sub);
        if (!userId) {
          console.error('[paypal-webhook] user 미해석 — sub:', sub.id, 'email:', sub.subscriber && sub.subscriber.email_address);
          sendTextToTelegramSafe('🚨 PayPal 구독을 회원과 못 묶음 sub=' + sub.id + ' email=' + ((sub.subscriber || {}).email_address || '?'));
          return res.status(200).json({ received: true, unmatched: true });
        }
        const r = await upsertSubscription(sub, userId);
        return res.status(200).json({ received: true, ...r });
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        const userId = await resolveUserId(resource);
        if (!userId) return res.status(200).json({ received: true, unmatched: true });
        const r = await handleTermination(resource, userId, type);
        return res.status(200).json({ received: true, ...r });
      }

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        const userId = await resolveUserId(resource);
        if (!userId) return res.status(200).json({ received: true, unmatched: true });
        // 접근권은 아직 끊지 않는다 — PayPal 이 3회까지 재시도한다(플랜 설정).
        // 기간 만료로 자연 종료되거나 CANCELLED 가 오면 그때 강등된다.
        await supabaseAdmin.from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('user_id', userId);
        sendTextToTelegramSafe('⚠️ PayPal 결제 실패 sub=' + resource.id + ' — past_due 로 표시(접근권 유지)');
        return res.status(200).json({ received: true, status: 'past_due' });
      }

      case 'PAYMENT.SALE.COMPLETED': {
        // 갱신 결제. 상태는 BILLING.SUBSCRIPTION.* 가 담당하고 여기선 기간만 늘린다.
        const subId = resource.billing_agreement_id;
        if (!subId) return res.status(200).json({ received: true, ignored: 'no_subscription' });
        try {
          const sub = await paypalGet(`/v1/billing/subscriptions/${subId}`);
          const bi = sub.billing_info || {};
          // 2026-08-12 — 결제가 성공했으니 past_due 표시를 되돌린다.
          // 예전에는 기간만 늘리고 status 를 그대로 뒀다. 재시도로 결제가 성사돼도
          // past_due 로 남아 어드민 지표(연체 N명)가 계속 틀렸다.
          const patch = {
            current_period_start: (bi.last_payment && bi.last_payment.time) || null,
            current_period_end: bi.next_billing_time || null,
            updated_at: new Date().toISOString(),
          };
          if (String(sub.status || '').toUpperCase() === 'ACTIVE') patch.status = 'active';
          await supabaseAdmin.from('subscriptions').update(patch)
            .eq('paypal_subscription_id', subId);
        } catch (e) {
          console.warn('[paypal-webhook] 갱신 기간 반영 실패:', e.message);
        }
        return res.status(200).json({ received: true });
      }

      case 'PAYMENT.CAPTURE.COMPLETED': {
        const r = await handleCaptureCompleted(supabaseAdmin, resource);
        return res.status(200).json({ received: true, ...r });
      }

      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED': {
        const r = await handleCaptureRefunded(supabaseAdmin, resource, type);
        return res.status(200).json({ received: true, ...r });
      }

      case 'CUSTOMER.DISPUTE.CREATED':
      case 'CUSTOMER.DISPUTE.UPDATED': {
        // 분쟁은 자동으로 처리하지 않는다. 사람이 기한 안에 답해야 한다.
        const amt = ((resource.dispute_amount || {}).value || '')
          + ((resource.dispute_amount || {}).currency_code || '');
        sendTextToTelegramSafe('⚖️ PayPal 분쟁 ' + type + ' id=' + resource.dispute_id
          + ' 금액 ' + amt + ' 사유=' + (resource.reason || '?')
          + ' — PayPal 해결 센터에서 기한 안에 답변해야 합니다.');
        return res.status(200).json({ received: true, dispute: true });
      }

      default:
        return res.status(200).json({ received: true, ignored: type });
    }
  } catch (e) {
    // 일시적 DB/네트워크 오류는 500 으로 돌려 PayPal 재시도를 유도한다.
    console.error('[paypal-webhook] 처리 실패:', type, e.message);
    return res.status(500).json({ error: 'processing failed' });
  }
};
