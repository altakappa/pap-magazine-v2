/**
 * POST /api/subscriptions/portal — Manage subscription (cancel / info)
 * Since PortOne doesn't have a hosted portal like Stripe,
 * we handle subscription management directly.
 *
 * Actions:
 *   - GET:  returns current subscription info
 *   - POST: { action: 'cancel' } → cancels subscription
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const PORTONE_API_BASE = 'https://api.portone.io';
const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    // Get current subscription
    const { data: subscriber } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!subscriber) {
      return res.status(404).json({ message: 'No subscription found' });
    }

    // GET → return subscription info
    if (req.method === 'GET') {
      return res.status(200).json({
        plan: subscriber.plan,
        billing_cycle: subscriber.billing_cycle,
        status: subscriber.status,
        current_period_start: subscriber.current_period_start,
        current_period_end: subscriber.current_period_end,
      });
    }

    // POST → handle action
    const { action } = req.body;

    if (action === 'cancel') {
      // Delete billing key from PortOne to stop future payments
      if (subscriber.portone_billing_key) {
        try {
          await fetch(
            `${PORTONE_API_BASE}/billing-keys/${encodeURIComponent(subscriber.portone_billing_key)}`,
            {
              method: 'DELETE',
              headers: {
                'Authorization': `PortOne ${PORTONE_API_SECRET}`,
                'Content-Type': 'application/json',
              },
            }
          );
        } catch (err) {
          console.warn('Failed to delete billing key:', err.message);
        }
      }

      // Update subscription status — keep active until period end
      await supabaseAdmin.from('subscriptions').update({
        status: 'cancel_scheduled',
      }).eq('user_id', user.id);

      return res.status(200).json({
        success: true,
        message: 'Subscription will be canceled at end of current period',
        cancel_at: subscriber.current_period_end,
      });
    }

    return res.status(400).json({ message: 'Invalid action' });
  } catch (error) {
    console.error('Portal error:', error);
    return res.status(500).json({ message: 'Failed to manage subscription' });
  }
};
