/**
 * POST /api/stripe-webhook — Handle Stripe webhook events
 * Raw body required for signature verification
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { supabaseAdmin } = require('./_lib/supabase');
const { sendEmail, templates } = require('./_lib/email');
const { resolveEmailLang } = require('./_lib/emailLocale');

// Disable body parsing — Stripe needs raw body for signature verification
module.exports.config = {
  api: { bodyParser: false },
};

// Collect raw body
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Price ID → plan name mapping
function getPlanName(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_STD_M]: 'standard_monthly',
    [process.env.STRIPE_PRICE_STD_Y]: 'standard_yearly',
    [process.env.STRIPE_PRICE_PREM_M]: 'premium_monthly',
    [process.env.STRIPE_PRICE_PREM_Y]: 'premium_yearly',
  };
  return map[priceId] || 'unknown';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        if (!userId) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = subscription.items.data[0].price.id;
        const plan = getPlanName(priceId);
        const billingCycle = subscription.items.data[0].price.recurring?.interval || 'month';

        await supabaseAdmin.from('subscribers').upsert({
          user_id: userId,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          plan,
          billing_cycle: billingCycle === 'year' ? 'yearly' : 'monthly',
          status: 'active',
          current_period_start: new Date(subscription.current_period_start * 1000),
          current_period_end: new Date(subscription.current_period_end * 1000),
        }, { onConflict: 'user_id' });

        await supabaseAdmin.from('profiles').update({
          subscription_plan: plan,
          subscription_status: 'active',
        }).eq('id', userId);

        // Send confirmation email
        const { data: subProfile } = await supabaseAdmin
          .from('profiles').select('email, name, email_language, language, country').eq('id', userId).single();
        if (subProfile) {
          sendEmail(subProfile.email, templates.subscriptionConfirmed({ name: subProfile.name }, plan, resolveEmailLang(subProfile))).catch(() => {});
        }

        console.log('Subscription created for:', userId);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const { data: subscriber } = await supabaseAdmin
          .from('subscribers')
          .select('user_id')
          .eq('stripe_customer_id', sub.customer)
          .single();

        if (!subscriber) break;

        let dbStatus = sub.status === 'canceled' ? 'canceled' : 'active';

        await supabaseAdmin.from('subscribers').update({
          status: dbStatus,
          current_period_end: new Date(sub.current_period_end * 1000),
          cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
        }).eq('stripe_subscription_id', sub.id);

        if (dbStatus === 'canceled') {
          await supabaseAdmin.from('profiles').update({
            subscription_status: 'inactive',
          }).eq('id', subscriber.user_id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const { data: subscriber } = await supabaseAdmin
          .from('subscribers')
          .select('user_id')
          .eq('stripe_customer_id', sub.customer)
          .single();

        if (!subscriber) break;

        await supabaseAdmin.from('subscribers').update({ status: 'canceled' })
          .eq('stripe_subscription_id', sub.id);

        await supabaseAdmin.from('profiles').update({ subscription_status: 'inactive' })
          .eq('id', subscriber.user_id);
        break;
      }

      case 'invoice.payment_failed': {
        console.warn('Payment failed for customer:', event.data.object.customer);
        break;
      }

      default:
        console.log('Unhandled event:', event.type);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
