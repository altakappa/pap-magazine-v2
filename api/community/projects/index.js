/**
 * GET  /api/community/projects  — List projects (?status=)
 * POST /api/community/projects  — Create a project
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAuth } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // ── GET: List projects ──
  if (req.method === 'GET') {
    try {
      const { status } = req.query;

      let query = supabaseAdmin
        .from('community_projects')
        .select('*, profiles!inner(name, avatar_url, location)')
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data: projects, error } = await query;
      if (error) throw error;

      return res.status(200).json({
        projects: projects.map(p => ({
          id: p.id,
          title: p.title,
          description: p.description,
          rolesNeeded: p.roles_needed,
          location: p.location,
          deadline: p.deadline,
          status: p.status,
          applicationCount: p.application_count,
          createdAt: p.created_at,
          author: {
            id: p.user_id,
            name: p.profiles?.name,
            avatarUrl: p.profiles?.avatar_url,
            location: p.profiles?.location,
          },
        })),
      });
    } catch (error) {
      console.error('List projects error:', error);
      return res.status(500).json({ message: 'Failed to fetch projects' });
    }
  }

  // ── POST: Create project ──
  if (req.method === 'POST') {
    try {
      const { title, description, rolesNeeded, location, deadline } = req.body;

      if (!title || !description) {
        return res.status(400).json({ message: 'Title and description are required' });
      }

      const { data: project, error } = await supabaseAdmin
        .from('community_projects')
        .insert({
          user_id: user.id,
          title,
          description,
          roles_needed: rolesNeeded || [],
          location: location || null,
          deadline: deadline || null,
          status: 'open',
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ project });
    } catch (error) {
      console.error('Create project error:', error);
      return res.status(500).json({ message: 'Failed to create project' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
