/**
 * GET /api/pullletters/mine — Get current user's pull-letter requests
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { data: pullLetters, error } = await supabaseAdmin
      .from('pullletters')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ pullLetters });
  } catch (error) {
    console.error('Get my pull-letters error:', error);
    return res.status(500).json({ message: 'Failed to fetch pull-letters' });
  }
};
