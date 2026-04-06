/**
 * POST /api/community/projects/:id/apply — Apply to a project
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAuth } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { id: projectId } = req.query;
    const { role, message } = req.body;

    if (!role) {
      return res.status(400).json({ message: 'Role is required' });
    }

    // Check if already applied
    const { data: existing } = await supabaseAdmin
      .from('community_applications')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      return res.status(409).json({ message: 'You have already applied to this project' });
    }

    const { data: application, error } = await supabaseAdmin
      .from('community_applications')
      .insert({
        project_id: projectId,
        user_id: user.id,
        role,
        message: message || '',
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ application });
  } catch (error) {
    console.error('Apply to project error:', error);
    return res.status(500).json({ message: 'Failed to submit application' });
  }
};
