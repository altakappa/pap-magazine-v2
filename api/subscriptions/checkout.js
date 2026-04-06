/**
 * POST /api/subscriptions/checkout — Create Stripe Checkout session
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

// Price ID mapping from env
const PRICE_MAP = {
  standard_monthly: process.env.STRIPE_PRICE_STD_M,
  standard_yearly: process.env.STRIPE_PRICE_STD_Y,
  premium_monthly: process.env.STRIPE_PRICE_PREM_M,
  premium_yearly: process.env.STRIPE_PRICE_PREM_Y,
};

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { plan, billing } = req.body;
    // plan: 'standard' or 'premium'
    // billing: 'monthly' or 'yearly'

    const priceKey = `${plan}_${billing}`;
    const priceId = PRICE_MAP[priceKey];

    if (!priceId) {
      return res.status(400).json({ message: 'Invalid plan or billing cycle' });
    }

    const frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${frontendUrl}/subscribe.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/subscribe.html?canceled=true`,
      metadata: { user_id: user.id },
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ message: 'Failed to create checkout session' });
  }
};
