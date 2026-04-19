/**
 * GET /api/submissions/:id — Get submission by ID
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
    const { id } = req.query;

    const { data: submission, error } = await supabaseAdmin
      .from('submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Only allow owner or admin to view
    if (submission.user_id !== user.id && user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    return res.status(200).json({ submission });
  } catch (error) {
    console.error('Get submission error:', error);
    return res.status(500).json({ message: 'Failed to fetch submission' });
  }
};
