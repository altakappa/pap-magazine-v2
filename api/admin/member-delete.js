/**
 * DELETE /api/admin/member-delete — Suspend or delete a member (admin only)
 *
 * Body: { memberId, action } where action is 'suspend' or 'delete'
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { memberId, action } = req.body;

  if (!memberId) {
    return res.status(400).json({ message: 'memberId is required' });
  }

  if (!action || !['suspend', 'delete'].includes(action)) {
    return res.status(400).json({ message: 'action must be "suspend" or "delete"' });
  }

  // Prevent admin from suspending/deleting themselves
  if (memberId === admin.id) {
    return res.status(400).json({ message: 'Cannot suspend or delete your own account' });
  }

  try {
    // Check member exists
    const { data: member, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', memberId)
      .single();

    if (fetchError || !member) {
      return res.status(404).json({ message: 'Member not found' });
    }

    // Prevent deleting/suspending other admins
    if (member.role === 'admin') {
      return res.status(400).json({ message: 'Cannot suspend or delete another admin' });
    }

    if (action === 'suspend') {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          subscription_status: 'suspended',
          updated_at: new Date().toISOString(),
        })
        .eq('id', memberId);

      if (error) throw error;

      return res.status(200).json({
        message: 'Member suspended successfully',
        memberId,
        action: 'suspended',
      });
    }

    if (action === 'delete') {
      // Delete profile (cascades from auth.users via ON DELETE CASCADE)
      // First delete the profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', memberId);

      if (profileError) throw profileError;

      // Then delete from auth.users (which would also cascade, but profile is already gone)
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(memberId);

      if (authError) {
        console.error('Warning: Profile deleted but auth user removal failed:', authError);
      }

      return res.status(200).json({
        message: 'Member deleted successfully',
        memberId,
        action: 'deleted',
      });
    }
  } catch (error) {
    console.error('Admin member-delete error:', error);
    return res.status(500).json({ message: 'Failed to process member action' });
  }
};
