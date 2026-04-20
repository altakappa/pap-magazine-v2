/**
 * GET   /api/community/projects/:id/manage — List applications (project owner)
 * PATCH /api/community/projects/:id/manage — Accept/reject an application
 * PUT   /api/community/projects/:id/manage — Update project status/details
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAuth } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const allowed = ['GET', 'PATCH', 'PUT'];
  if (!allowed.includes(req.method)) {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const { id: projectId } = req.query;

  // Helper: verify project ownership or admin
  async function verifyAccess() {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    const isAdmin = profile && profile.role === 'admin';

    const { data: project } = await supabaseAdmin
      .from('community_projects')
      .select('user_id')
      .eq('id', projectId)
      .single();

    if (!project) return { error: 404 };
    if (!isAdmin && project.user_id !== user.id) return { error: 403 };
    return { ok: true, isAdmin };
  }

  // ── GET: List applications for this project ──
  if (req.method === 'GET') {
    try {
      const access = await verifyAccess();
      if (access.error === 404) return res.status(404).json({ message: 'Project not found' });
      if (access.error === 403) return res.status(403).json({ message: 'Not authorized' });

      const { data: applications, error } = await supabaseAdmin
        .from('community_applications')
        .select('*, profiles!inner(name, avatar_url, instagram, location)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.status(200).json({
        applications: applications.map(a => ({
          id: a.id,
          role: a.role,
          message: a.message,
          status: a.status || 'pending',
          createdAt: a.created_at,
          applicant: {
            id: a.user_id,
            name: a.profiles?.name,
            avatarUrl: a.profiles?.avatar_url,
            instagram: a.profiles?.instagram,
            location: a.profiles?.location,
          },
        })),
      });
    } catch (error) {
      console.error('List applications error:', error);
      return res.status(500).json({ message: 'Failed to fetch applications' });
    }
  }

  // ── PATCH: Accept/reject an application ──
  if (req.method === 'PATCH') {
    try {
      const access = await verifyAccess();
      if (access.error === 404) return res.status(404).json({ message: 'Project not found' });
      if (access.error === 403) return res.status(403).json({ message: 'Not authorized' });

      const { applicationId, status } = req.body;
      if (!applicationId || !['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ message: 'applicationId and status (accepted/rejected) required' });
      }

      const { data: updated, error } = await supabaseAdmin
        .from('community_applications')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', applicationId)
        .eq('project_id', projectId)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ application: updated });
    } catch (error) {
      console.error('Manage application error:', error);
      return res.status(500).json({ message: 'Failed to update application' });
    }
  }

  // ── PUT: Update project details/status ──
  if (req.method === 'PUT') {
    try {
      const access = await verifyAccess();
      if (access.error === 404) return res.status(404).json({ message: 'Project not found' });
      if (access.error === 403) return res.status(403).json({ message: 'Not authorized' });

      const { title, description, rolesNeeded, location, deadline, status } = req.body;
      const updates = { updated_at: new Date().toISOString() };
      if (title) updates.title = title;
      if (description) updates.description = description;
      if (rolesNeeded) updates.roles_needed = rolesNeeded;
      if (location !== undefined) updates.location = location;
      if (deadline !== undefined) updates.deadline = deadline;
      if (status && ['open', 'closed', 'completed'].includes(status)) updates.status = status;

      const { data: updated, error } = await supabaseAdmin
        .from('community_projects')
        .update(updates)
        .eq('id', projectId)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ project: updated });
    } catch (error) {
      console.error('Update project error:', error);
      return res.status(500).json({ message: 'Failed to update project' });
    }
  }
};
