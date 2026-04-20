/**
 * POST /api/community/reports — Report a post or comment
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { target_type, target_id, reason } = req.body;

    if (!target_type || !target_id || !reason) {
      return res.status(400).json({ message: 'target_type, target_id, and reason are required' });
    }

    if (!['post', 'comment'].includes(target_type)) {
      return res.status(400).json({ message: 'target_type must be "post" or "comment"' });
    }

    // Prevent duplicate reports
    const { data: existing } = await supabaseAdmin
      .from('community_reports')
      .select('id')
      .eq('reporter_id', user.id)
      .eq('target_type', target_type)
      .eq('target_id', target_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ message: 'You have already reported this content' });
    }

    const { data: report, error } = await supabaseAdmin
      .from('community_reports')
      .insert({
        reporter_id: user.id,
        target_type,
        target_id,
        reason,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ report });
  } catch (error) {
    console.error('Report error:', error);
    return res.status(500).json({ message: 'Failed to submit report' });
  }
};
