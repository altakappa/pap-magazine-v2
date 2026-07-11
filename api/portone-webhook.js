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

// Verify webhook signature
function verifySignature(rawBody, signature) {
  if (!PORTONE_WEBHOOK_SECRET) {
    console.warn('[PortOne] PORTONE_WEBHOOK_SECRET not configured — rejecting webhook');
    return false;
  }
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', PORTONE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (e) {
    return false;
  }
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
  const signature = req.headers['x-portone-signature'];

  if (!verifySignature(rawBody, signature)) {
    console.error('Webhook signature verification failed');
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
        console.warn('Payment failed:', paymentId);

        // Try to find user and update status
        const match = paymentId?.match(/^pap_(?:g_|sched_)?([^_]+(?:-[^_]+)*)_\d+$/);
        if (match) {
          const userId = match[1];
          await supabaseAdmin.from('subscriptions').update({
            status: 'payment_failed',
          }).eq('user_id', userId);
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
        await supabaseAdmin.from('profiles').update({ subscription_status: 'inactive' })
          .eq('id', userId);
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
          await supabaseAdmin.from('profiles').update({ subscription_status: 'inactive' })
            .eq('id', subscriber.user_id);
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
