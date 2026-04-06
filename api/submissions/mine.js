/**
 * GET /api/submissions/mine — Get current user's submissions
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { data: submissions, error } = await supabaseAdmin
      .from('submissions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ submissions });
  } catch (error) {
    console.error('Get my submissions error:', error);
    return res.status(500).json({ message: 'Failed to fetch submissions' });
  }
};
