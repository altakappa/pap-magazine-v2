/**
 * POST /api/portone-webhook — Handle PortOne V2 webhook events
 *
 * PortOne sends webhooks for:
 *   - Transaction.Paid        — payment succeeded
 *   - Transaction.Failed      — payment failed
 *   - Transaction.Cancelled   — payment cancelled/refunded
 *   - BillingKey.Deleted      — billing key removed
 *   - PaymentSchedule.Paid    — scheduled (recurring) payment succeeded
 *   - PaymentSchedule.Failed  — scheduled payment failed
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { sendEmail, templates } = require('./_lib/email');
const { resolveEmailLang } = require('./_lib/emailLocale');
const { basePlanFromPlanKey, downgradeToFree } = require('./_lib/subscriptionAccess');
const { sendTextToTelegramSafe } = require('./_lib/telegram');
const crypto = require('crypto');

const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;
const PORTONE_WEBHOOK_SECRET = process.env.PORTONE_WEBHOOK_SECRET;
const PORTONE_API_BASE = 'https://api.portone.io';

// Disable body parsing for raw body access
module.exports.config = {
  api: { bodyParser: false },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function _timingEqual(a, b) {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch (_) {
    return false;
  }
}

// Verify webhook signature — PortOne V2 는 Standard Webhooks 규격을 쓴다.
//
// 2026-07-20 감사 교정: 기존 구현은 단일 `x-portone-signature` 헤더에 body만
// hex-HMAC 하는 자작 방식이라 실제 PortOne V2 웹훅(헤더 webhook-id/webhook-timestamp/
// webhook-signature, base64 HMAC over `${id}.${timestamp}.${body}`, whsec_ 시크릿)을
// 전량 거부했다. 규격에 맞게 재구현한다.
//
// 대안: 공식 `@portone/server-sdk` 의 `Webhook.verify(secret, body, headers)`.
// ⚠️ 국내 결제를 실제 개시하기 전에, PortOne 콘솔의 웹훅 시크릿(whsec_...)이 Vercel
//    PORTONE_WEBHOOK_SECRET 과 일치하는지 확인하고 테스트 웹훅으로 200 라이브 검증할 것.
function verifyStandardWebhook(rawBody, headers) {
  if (!PORTONE_WEBHOOK_SECRET) {
    console.warn('[PortOne] PORTONE_WEBHOOK_SECRET not configured — rejecting webhook');
    return false;
  }
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const sigHeader = headers['webhook-signature'];
  if (!id || !timestamp || !sigHeader) return false;

  // Replay guard — 5분 초과 이벤트 거부.
  const ts = parseInt(timestamp, 10);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  // 시크릿이 whsec_<base64> 형태면 base64 디코드한 바이트가 실제 HMAC 키.
  const secret = PORTONE_WEBHOOK_SECRET;
  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret);

  const signedContent = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');

  // webhook-signature 는 공백구분 "v1,<base64>" 목록 — 하나라도 일치하면 통과.
  return String(sigHeader).split(' ').some((part) => {
    const comma = part.indexOf(',');
    const sig = comma >= 0 ? part.slice(comma + 1) : part;
    return _timingEqual(sig, expected);
  });
}

// Helper: call PortOne V2 REST API
async function portoneRequest(method, path) {
  const res = await fetch(`${PORTONE_API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `PortOne ${PORTONE_API_SECRET}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// Calculate next billing date from current period end
function getNextBillingDate(billingCycle, fromDate) {
  const d = new Date(fromDate);
  if (billingCycle === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);

  // 서명검증은 Standard Webhooks 규격(webhook-id/webhook-timestamp/webhook-signature).
  // 실패 시 로그만 남긴다 — 여기서 텔레그램 알림을 보내면 위조 요청으로 알림 폭탄을
  // 맞을 수 있어(서버리스라 인메모리 쿨다운 불가) 의도적으로 알림은 생략한다.
  if (!verifyStandardWebhook(rawBody, req.headers)) {
    console.error('[PortOne] webhook signature verification failed (Standard Webhooks)');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    const { type, data } = event;
    /* Webhook event received */

    switch (type) {
      // ── First-time or one-off payment completed ──
      case 'Transaction.Paid': {
        const paymentId = data?.paymentId;
        if (!paymentId) break;

        // Verify payment on server side
        const payment = await portoneRequest('GET', `/payments/${encodeURIComponent(paymentId)}`);
        if (!payment || payment.status !== 'PAID') {
          console.warn('Payment verification failed for:', paymentId);
          break;
        }

        // Payment ID shape:
        //   authenticated:   pap_<UUID>_<timestamp>
        //   guest:           pap_g_<UUID>_<timestamp>
        //   recurring:       pap_sched_<UUID>_<timestamp>
        // The user UUID itself never contains underscores, so the
        // "any chars except underscore" cluster cleanly captures it.
        const match = paymentId.match(/^pap_(?:g_|sched_)?([^_]+(?:-[^_]+)*)_\d+$/);
        if (!match) break;
        const userId = match[1];

        // Send confirmation email
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('email, display_name, subscription_plan, email_language, language, country').eq('id', userId).single();

        if (profile && profile.email) {
          sendEmail(profile.email, templates.subscriptionConfirmed(
            { name: profile.display_name || profile.email },
            profile.subscription_plan,
            resolveEmailLang(profile)
          )).catch(() => {});
        }

        /* Payment confirmed */
        break;
      }

      // ── Scheduled (recurring) payment succeeded ──
      case 'PaymentSchedule.Paid': {
        const paymentId = data?.paymentId;
        if (!paymentId) break;

        // Extract user ID from schedule ID (pap_sched_{userId}_...)
        // UUID has no underscores so we capture cleanly up to next "_".
        const match = paymentId.match(/^pap_sched_([^_]+(?:-[^_]+)*)_\d+$/);
        if (!match) break;
        const userId = match[1];

        // Get subscriber info
        const { data: subscriber } = await supabaseAdmin
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (!subscriber) break;

        // Update period
        const now = new Date();
        const nextDate = getNextBillingDate(subscriber.billing_cycle, now);

        await supabaseAdmin.from('subscriptions').update({
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: nextDate.toISOString(),
          portone_payment_id: paymentId,
        }).eq('user_id', userId);

        // 2026-07-20 — 갱신 성공 시 profiles 등급/상태도 재확정한다. 직전 회차 실패로
        // status가 inactive로 내려간 회원이 이후 성공 청구돼도 profiles가 복원되지
        // 않던 문제 해소. 게이트가 profiles를 보므로 여기서 함께 활성화한다.
        await supabaseAdmin.from('profiles').update({
          subscription_plan: basePlanFromPlanKey(subscriber.plan),
          subscription_status: 'active',
        }).eq('id', userId);

        // Schedule next payment
        if (subscriber.portone_billing_key) {
          const planPrices = {
            standard_monthly: 8500, standard_yearly: 85000,
            premium_monthly: 13500, premium_yearly: 135000,
          };
          const amount = planPrices[subscriber.plan] || 8500;
          const nextSchedId = `pap_sched_${userId}_${Date.now()}`;

          try {
            await fetch(`${PORTONE_API_BASE}/payment-schedules`, {
              method: 'POST',
              headers: {
                'Authorization': `PortOne ${PORTONE_API_SECRET}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                paymentId: nextSchedId,
                billingKey: subscriber.portone_billing_key,
                orderName: `PAP ${subscriber.plan.replace('_', ' ')}`,
                amount: { total: amount },
                currency: 'KRW',
                customer: { id: userId },
                timeToPay: nextDate.toISOString(),
              }),
            });
          } catch (err) {
            console.error('Failed to schedule next payment:', err.message);
          }
        }

        /* Recurring payment confirmed */
        break;
      }

      // ── Payment failed ──
      case 'Transaction.Failed':
      case 'PaymentSchedule.Failed': {
        const paymentId = data?.paymentId;
        console.warn('[PortOne] payment failed:', paymentId);

        // Try to find user and update status
        const match = paymentId?.match(/^pap_(?:g_|sched_)?([^_]+(?:-[^_]+)*)_\d+$/);
        if (match) {
          const userId = match[1];
          await supabaseAdmin.from('subscriptions').update({
            status: 'payment_failed',
          }).eq('user_id', userId);
          // 2026-07-20 — 결제 실패 시 profiles.subscription_status도 inactive로 내려
          // 게이트(plan+status)가 접근을 차단하게 한다. plan은 유지해 이후 성공 청구로
          // 자연 복원(유예)되게 한다. (기존엔 profiles를 안 건드려 미납자가 접근 유지)
          await supabaseAdmin.from('profiles').update({
            subscription_status: 'inactive',
          }).eq('id', userId);
          // 검증 통과한 실이벤트이므로 알림은 안전(위조 폭탄 위험 없음).
          sendTextToTelegramSafe('⚠️ PortOne 정기결제 실패 — user_id: ' + userId + ' · 접근 일시중지(plan 유지). 재청구 확인 필요.');
        }
        break;
      }

      // ── Payment cancelled / refunded ──
      case 'Transaction.Cancelled': {
        const paymentId = data?.paymentId;
        const match = paymentId?.match(/^pap_(?:g_|sched_)?([^_]+(?:-[^_]+)*)_\d+$/);
        if (!match) break;
        const userId = match[1];

        await supabaseAdmin.from('subscriptions').update({ status: 'canceled' })
          .eq('user_id', userId);
        // 2026-07-20 — 해지/환불 시 등급(plan)까지 free로 강등한다. 게이트가 plan을
        // 보므로 status만 내리면 해지회원이 계속 접근하던 결함(Paddle과의 비대칭) 해소.
        await downgradeToFree(supabaseAdmin, userId);
        break;
      }

      // ── Billing key deleted ──
      case 'BillingKey.Deleted': {
        const billingKey = data?.billingKey;
        if (!billingKey) break;

        await supabaseAdmin.from('subscriptions').update({
          status: 'canceled',
          portone_billing_key: null,
        }).eq('portone_billing_key', billingKey);

        // Also update profile
        const { data: subscriber } = await supabaseAdmin
          .from('subscriptions').select('user_id').eq('portone_billing_key', billingKey).single();
        if (subscriber) {
          // 빌링키 삭제 = 정기결제 수단 소멸 → 등급도 free로 강등(plan+status).
          await downgradeToFree(supabaseAdmin, subscriber.user_id);
        }
        break;
      }

      default:
        /* Unhandled webhook event */
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
