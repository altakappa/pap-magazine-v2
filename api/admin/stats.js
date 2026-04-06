/**
 * GET /api/admin/stats — Dashboard statistics (admin only)
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
    // Total members
    const { count: totalMembers } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // Active subscriptions
    const { count: activeSubscriptions } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // Pending submissions
    const { count: pendingSubmissions } = await supabaseAdmin
      .from('submissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Pending pull-letters
    const { count: pendingPullletters } = await supabaseAdmin
      .from('pullletters')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // New members this month
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const { count: newMembersThisMonth } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thisMonth.toISOString());

    // Subscription breakdown
    const { data: planBreakdown } = await supabaseAdmin
      .from('profiles')
      .select('subscription_plan');

    const planCounts = {};
    if (planBreakdown) {
      planBreakdown.forEach(p => {
        const plan = p.subscription_plan || 'free';
        planCounts[plan] = (planCounts[plan] || 0) + 1;
      });
    }

    return res.status(200).json({
      totalMembers: totalMembers || 0,
      activeSubscriptions: activeSubscriptions || 0,
      pendingSubmissions: pendingSubmissions || 0,
      pendingPullletters: pendingPullletters || 0,
      newMembersThisMonth: newMembersThisMonth || 0,
      planBreakdown: planCounts,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ message: 'Failed to fetch stats' });
  }
};
