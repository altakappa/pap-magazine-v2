/**
 * PATCH /api/admin/member-update — Update a member's role, plan, or status (admin only)
 *
 * Body: { memberId, role?, subscriptionPlan?, subscriptionStatus? }
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin, requireMainAdmin, invalidateTokens } = require('../_lib/auth');
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
      // QA #181 — self-demotion guard, tightened.
      //
      // Old logic blocked ANY self-edit where the new role wasn't 'admin'.
      // That was over-broad: it also tripped when the editor's id happened
      // to equal the target id but the target was already 'staff'/'member'
      // (in which case there's nothing to "demote from" and no lock-out
      // risk). The QA report (#181) flagged this as the cause of the
      // misleading "Cannot change your own admin role" error.
      //
      // New rule — ONLY block when ALL of:
      //   1. caller and target are the SAME row (normalized string match)
      //   2. target's CURRENT role is actually 'admin'
      //   3. proposed new role is NOT 'admin' (i.e. a real demotion)
      // This still prevents the genuine lock-out scenario (the last main
      // admin demoting themselves) without false-positive blocking any
      // other legitimate edit.
      const sameRow = String(memberId || '').trim() === String(admin.id || '').trim();
      const currentIsAdmin = profile.role === 'admin';
      if (sameRow && currentIsAdmin && role !== 'admin') {
        return res.status(400).json({
          message: '본인 계정의 대표 관리자 권한은 직접 해제할 수 없습니다. 다른 대표 관리자에게 부탁하세요.',
        });
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

    // QA #203 — when role actually CHANGED, bump the target user's
    // token_version so their existing JWT becomes invalid. Without this
    // a freshly-promoted 서브 관리자 still carries a JWT whose role
    // claim says 'member' (or whatever it was), so /api/auth/me keeps
    // returning the old role until they manually log out. Likewise a
    // demotion would otherwise leave the demoted user with admin
    // privileges until their JWT happens to expire. Skip the bump when
    // the role didn't change (plan/status edits) so we don't kick users
    // off for unrelated profile updates.
    const roleChanged = role !== undefined && profile.role !== role;
    let tokenInvalidated = false;
    if (roleChanged) {
      try {
        await invalidateTokens(memberId);
        tokenInvalidated = true;
      } catch (e) {
        // Surface in logs; the UI will still show the new role on the
        // next manual login even if the bump fails (just slower
        // propagation).
        console.warn('[member-update] invalidateTokens failed for', memberId, e && e.message);
      }
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
      // QA #203 — let the admin UI surface a "재로그인 안내" toast when
      // the target user actually got bumped off their session.
      tokenInvalidated,
      roleChanged,
    });
  } catch (error) {
    console.error('Admin member-update error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
