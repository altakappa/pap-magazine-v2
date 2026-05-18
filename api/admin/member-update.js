/**
 * PATCH /api/admin/member-update — Update a member's role, plan, or status (admin only)
 *
 * Body: { memberId, role?, subscriptionPlan?, subscriptionStatus? }
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin, requireMainAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'PATCH') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // QA #169 — role changes are reserved for the main admin; plan / status
  // updates stay open to staff. Pre-peek at the body so we can pick the
  // right middleware before reading anything else.
  const wantsRoleChange = req.body && typeof req.body.role !== 'undefined';
  let admin;
  try {
    admin = wantsRoleChange
      ? await requireMainAdmin(req, res)
      : await requireAdmin(req, res);
    if (!admin) return;
  } catch (e) {
    return res.status(401).json({ message: 'Auth failed' });
  }

  const { memberId, role, subscriptionPlan, subscriptionStatus } = req.body;

  if (!memberId) {
    return res.status(400).json({ message: 'memberId is required' });
  }

  try {
    // First, fetch the profile to discover actual column names
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', memberId)
      .single();

    if (fetchErr || !profile) {
      return res.status(404).json({ message: 'Member not found' });
    }

    // Detect actual column names in the table
    const cols = Object.keys(profile);

    // Build update object using actual column names.
    // QA #169 — 'staff' added to the allowed-role allow-list so the main
    // admin can promote a 'member' to a sub-admin (staff) from the UI.
    const updates = {};
    const allowedRoles = ['member', 'contributor', 'staff', 'admin'];
    const allowedPlans = ['free', 'standard', 'premium'];
    const allowedStatuses = ['active', 'inactive', 'suspended', 'cancelled'];

    if (role !== undefined) {
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ message: 'Invalid role. Allowed: ' + allowedRoles.join(', ') });
      }
      // Prevent the main admin from accidentally demoting themselves —
      // they'd lock themselves out of the panel until another main admin
      // re-promotes them. Demotion of OTHER admins is still allowed.
      if (role !== 'admin' && memberId === admin.id) {
        return res.status(400).json({ message: 'Cannot change your own admin role' });
      }
      if (cols.includes('role')) updates.role = role;
    }

    if (subscriptionPlan !== undefined) {
      if (!allowedPlans.includes(subscriptionPlan)) {
        return res.status(400).json({ message: 'Invalid plan. Allowed: ' + allowedPlans.join(', ') });
      }
      // Try known column name variants
      if (cols.includes('subscription_plan')) updates.subscription_plan = subscriptionPlan;
      else if (cols.includes('plan')) updates.plan = subscriptionPlan;
    }

    if (subscriptionStatus !== undefined) {
      if (!allowedStatuses.includes(subscriptionStatus)) {
        return res.status(400).json({ message: 'Invalid status. Allowed: ' + allowedStatuses.join(', ') });
      }
      if (cols.includes('subscription_status')) updates.subscription_status = subscriptionStatus;
      else if (cols.includes('status')) updates.status = subscriptionStatus;
    }

    if (cols.includes('updated_at')) {
      updates.updated_at = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid updatable fields found', availableColumns: cols });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', memberId)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ message: 'Update failed' });
    }

    return res.status(200).json({
      message: 'Member updated successfully',
      member: {
        id: data.id,
        email: data.email,
        name: data.display_name || data.name || data.email,
        role: data.role,
        subscriptionPlan: data.subscription_plan || data.plan || 'free',
        subscriptionStatus: data.subscription_status || data.status || 'inactive',
      },
    });
  } catch (error) {
    console.error('Admin member-update error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
