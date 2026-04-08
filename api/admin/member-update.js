/**
 * PATCH /api/admin/member-update — Update a member's role, plan, or status (admin only)
 *
 * Body: { memberId, role?, subscriptionPlan?, subscriptionStatus? }
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'PATCH') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { memberId, role, subscriptionPlan, subscriptionStatus } = req.body;

  if (!memberId) {
    return res.status(400).json({ message: 'memberId is required' });
  }

  // Build update object with only provided fields
  const updates = {};
  const allowedRoles = ['member', 'contributor', 'admin'];
  const allowedPlans = ['free', 'standard', 'premium'];
  const allowedStatuses = ['active', 'inactive', 'suspended', 'cancelled'];

  if (role !== undefined) {
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: `Invalid role. Allowed: ${allowedRoles.join(', ')}` });
    }
    updates.role = role;
  }

  if (subscriptionPlan !== undefined) {
    if (!allowedPlans.includes(subscriptionPlan)) {
      return res.status(400).json({ message: `Invalid plan. Allowed: ${allowedPlans.join(', ')}` });
    }
    updates.subscription_plan = subscriptionPlan;
  }

  if (subscriptionStatus !== undefined) {
    if (!allowedStatuses.includes(subscriptionStatus)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` });
    }
    updates.subscription_status = subscriptionStatus;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: 'No valid fields to update' });
  }

  updates.updated_at = new Date().toISOString();

  try {
    // Prevent admin from demoting themselves
    if (updates.role && updates.role !== 'admin' && memberId === admin.id) {
      return res.status(400).json({ message: 'Cannot change your own admin role' });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', memberId)
      .select('*')
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ message: 'Member not found' });
    }

    return res.status(200).json({
      message: 'Member updated successfully',
      member: {
        id: data.id,
        email: data.email,
        name: data.display_name || data.name || data.email,
        role: data.role,
        subscriptionPlan: data.subscription_plan || data.plan,
        subscriptionStatus: data.subscription_status || data.status,
      },
    });
  } catch (error) {
    console.error('Admin member-update error:', error);
    return res.status(500).json({ message: 'Failed to update member' });
  }
};
