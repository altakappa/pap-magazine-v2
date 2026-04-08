/**
 * GET /api/admin/members — List all members (admin only)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const { data: members, error } = await supabaseAdmin
      .from('profiles')
      .select(`
        id, email, name, role, subscription_plan, subscription_status,
        location, instagram, created_at, updated_at
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Enrich with submission and pullletter counts (non-blocking)
    const submissionMap = {};
    const pullletterMap = {};

    try {
      const { data: subCounts } = await supabaseAdmin
        .from('submissions')
        .select('user_id');
      if (subCounts) {
        subCounts.forEach(s => {
          submissionMap[s.user_id] = (submissionMap[s.user_id] || 0) + 1;
        });
      }
    } catch (e) {
      console.warn('Could not load submissions counts:', e.message);
    }

    try {
      const { data: plCounts } = await supabaseAdmin
        .from('pullletters')
        .select('user_id');
      if (plCounts) {
        plCounts.forEach(p => {
          pullletterMap[p.user_id] = (pullletterMap[p.user_id] || 0) + 1;
        });
      }
    } catch (e) {
      console.warn('Could not load pullletter counts:', e.message);
    }

    return res.status(200).json({
      members: members.map(m => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        subscriptionPlan: m.subscription_plan,
        subscriptionStatus: m.subscription_status,
        location: m.location,
        instagram: m.instagram,
        joinedAt: m.created_at,
        submissionCount: submissionMap[m.id] || 0,
        pullletterCount: pullletterMap[m.id] || 0,
      })),
    });
  } catch (error) {
    console.error('Admin members error:', error);
    return res.status(500).json({ message: 'Failed to fetch members' });
  }
};
