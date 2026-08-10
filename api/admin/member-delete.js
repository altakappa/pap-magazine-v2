/**
 * DELETE /api/admin/member-delete — Suspend or delete a member (admin only)
 *
 * Body: { memberId, action } where action is 'suspend' or 'delete'
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { cancelProviderSubscription } = require('../_lib/cancelProviderSubscription');
const { requireMainAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // QA #169 — suspending or deleting an account is irreversible, so it's
  // gated to the main admin only. Staff who try will see a 403.
  const admin = await requireMainAdmin(req, res);
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
      // ⚠️ 2026-08-10 — 회원을 지우기 전에 결제사 구독을 먼저 끊는다.
      // 이게 없으면 회원은 사라지는데 PayPal·Paddle 구독은 살아서 매달 계속
      // 청구된다(결제사는 우리 DB 를 모른다). 서비스는 못 쓰는데 돈만 나가는
      // 상태가 되고, 웹훅이 와도 회원이 없어 매칭에 실패해 조용히 지나간다.
      //
      // 정책: 이미 낸 기간은 환불하지 않는다. 다음 결제만 막는다.
      // 실패하면 삭제를 진행하지 않는다 — 돈이 계속 나가는 것보다 삭제가
      // 안 되는 편이 낫다.
      const cancelRes = await cancelProviderSubscription(supabaseAdmin, memberId);
      if (!cancelRes.ok) {
        console.error('[member-delete] 구독 해지 실패 — 삭제 중단:', memberId, cancelRes.message);
        return res.status(409).json({
          message: '구독 해지에 실패해 삭제를 중단했습니다. 결제사 콘솔에서 먼저 해지한 뒤 다시 시도하세요.',
          code: 'subscription_cancel_failed',
          detail: cancelRes.message || null,
        });
      }

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
        subscriptionCancel: cancelRes.action,
      });
    }
  } catch (error) {
    console.error('Admin member-delete error:', error);
    return res.status(500).json({ message: 'Failed to process member action' });
  }
};
