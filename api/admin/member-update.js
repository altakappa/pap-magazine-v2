/**
 * PATCH /api/admin/member-update — Update a member's role, plan, or status (admin only)
 *
 * Body: { memberId, role?, subscriptionPlan?, subscriptionStatus? }
 *
 * 🔴 2026-08-12 — '취소됨' 은 글자만 바꾸는 가짜 취소였다.
 *
 *   운영자가 회원 편집창에서 구독 상태를 '취소됨' 으로 바꾸고 저장하면,
 *   이 파일은 profiles.subscription_status 에 문자열 'cancelled' 를 쓰는 것이
 *   전부였다. 결제사에는 아무 일도 일어나지 않는다. PayPal 은 우리 DB 를 모르므로
 *   다음 달에도 €5.49 / €8.99 를 그대로 긁는다. 화면에는 "취소됨" 이라고 떠 있는데.
 *
 *   실제로 해지를 실행하는 헬퍼(cancelProviderSubscription)는 이미 있었지만
 *   호출하는 곳이 회원 '삭제' 와 본인 '탈퇴' 뿐이었다. 즉 운영자가 결제를 멈추려면
 *   회원을 통째로 지우는 방법밖에 없었다. 8/14 에 Paddle 고객 포털이라는
 *   안전망까지 사라지면 남는 수단이 없다.
 *
 *   이제 '취소됨' 은 결제사 해지를 먼저 실행하고, 성공했을 때만 상태를 바꾼다.
 *   실패하면 아무것도 바꾸지 않는다 — 화면과 결제사가 어긋나는 것이 원래 문제였다.
 *   환불은 하지 않는다(2026-08-10 도메니코 정책). 다음 결제만 멈춘다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin, requireMainAdmin, invalidateTokens } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { cancelProviderSubscription } = require('../_lib/cancelProviderSubscription');

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

    // 🔴 '취소됨' 은 결제사에서 실제로 끊고 나서야 표시한다.
    //    헬퍼는 멱등이다 — 이미 canceled/expired 면 결제사를 부르지 않고
    //    action:'already' 로 돌아온다. 그래서 재저장해도 안전하다.
    //    실패하면 profiles 를 건드리지 않는다. 화면만 '취소됨' 이 되고 결제는
    //    계속되는 상태가 바로 이 수정이 없애려는 것이다.
    let cancelResult = null;
    if (subscriptionStatus === 'cancelled') {
      cancelResult = await cancelProviderSubscription(supabaseAdmin, memberId);
      if (!cancelResult.ok) {
        return res.status(409).json({
          code: 'subscription_cancel_failed',
          message: '결제사 구독 해지에 실패해 상태를 바꾸지 않았습니다. ('
            + (cancelResult.message || '이유 미상') + ') 결제사 대시보드에서 직접 확인해 주세요.',
        });
      }
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
      // 2026-08-12 — 결제사 해지가 실제로 무엇을 했는지 화면에 그대로 보여준다.
      //   'canceled' 실제로 끊었다 · 'already' 이미 끊겨 있었다 · 'none' 끊을 구독이 없다
      subscriptionCancel: cancelResult ? cancelResult.action : null,
      subscriptionCancelProvider: cancelResult ? (cancelResult.provider || null) : null,
    });
  } catch (error) {
    console.error('Admin member-update error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
