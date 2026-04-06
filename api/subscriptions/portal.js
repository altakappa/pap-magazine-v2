/**
 * POST /api/subscriptions/portal — Create Stripe Customer Portal session
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    // Get Stripe customer ID from database
    const { data: subscriber } = await supabaseAdmin
      .from('subscribers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!subscriber || !subscriber.stripe_customer_id) {
      return res.status(404).json({ message: 'No active subscription found' });
    }

    const frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscriber.stripe_customer_id,
      return_url: `${frontendUrl}/subscribe.html`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (error) {
    console.error('Portal error:', error);
    return res.status(500).json({ message: 'Failed to create portal session' });
  }
};
