/**
 * POST /api/auth/withdraw — 회원 탈퇴 (본인)
 *
 * body: { confirm:'DELETE', mode?: 'end_of_period' | 'now' }
 *
 * ■ 핵심 정책 (2026-08-10 도메니코 확정)
 *   "탈퇴해도 서비스가 바로 끊기는 게 아니라 한 달치는 이용할 수 있어야 한다."
 *   "이미 낸 한 달치는 환불하지 않는다. 재결제만 막는다."
 *   → 남은 유료 기간이 있으면 **즉시 삭제하지 않는다.** 구독만 끊고,
 *     기간이 끝나는 날로 삭제를 예약한다. 그 사이 서비스는 그대로 쓴다.
 *   → 실제 삭제는 api/cron/withdraw-purge.js 가 수행한다.
 *
 * ■ 그런데 '탈퇴' 에는 성격이 다른 두 요청이 섞여 있다
 *     ① "구독 그만할래"      → 남은 기간 쓰고 나간다 (기본값)
 *     ② "내 개인정보 지워줘" → 지금 당장 지워야 한다 (정보주체의 권리)
 *   ②를 한 달 미루면 삭제 요구를 거부하는 셈이 된다. 그래서 mode='now' 를
 *   남겨 둔다. 남은 기간을 본인이 포기한다고 명시할 때만 즉시 삭제한다.
 *
 * ■ 순서가 전부다
 *   1) 결제사 구독을 먼저 끊는다 (환불 아님 — 다음 결제 중단)
 *   2) 실패하면 탈퇴를 중단한다 — 돈이 계속 나가는 것보다 낫다
 *   3) 남은 기간 유무에 따라 예약 또는 즉시 삭제
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuthStrict } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { cancelProviderSubscription } = require('../_lib/cancelProviderSubscription');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

async function hardDelete(userId) {
  const { error: profileError } = await supabaseAdmin.from('profiles').delete().eq('id', userId);
  if (profileError) throw new Error(profileError.message);
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authError) {
    // 프로필은 지워졌는데 auth 가 남으면 로그인은 되고 데이터는 없는 상태가 된다.
    console.error('[withdraw] profile 삭제됨 / auth 사용자 삭제 실패:', userId, authError.message);
    sendTextToTelegramSafe('⚠️ 탈퇴: profiles 삭제됐으나 auth 사용자 삭제 실패 — 수동 정리 필요 user=' + userId);
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  // 되돌릴 수 없는 작업이라 token_version 까지 검증하는 strict 경로를 쓴다.
  const user = await requireAuthStrict(req, res);
  if (!user) return;

  const body = req.body || {};
  if (body.confirm !== 'DELETE') {
    return res.status(400).json({ message: 'confirm required', code: 'confirm_required' });
  }
  const mode = body.mode === 'now' ? 'now' : 'end_of_period';

  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('id, email, role, withdraw_delete_after').eq('id', user.id).maybeSingle();
    if (!profile) return res.status(404).json({ message: 'Account not found' });

    // 관리자 계정은 셀프 탈퇴로 지우지 않는다 — 실수 한 번이 운영을 멈춘다.
    if (profile.role === 'admin') {
      return res.status(403).json({
        message: '관리자 계정은 마이페이지에서 탈퇴할 수 없습니다. 운영팀에 문의하세요.',
        code: 'admin_cannot_self_delete',
      });
    }

    // 남은 유료 기간을 먼저 읽는다 (구독을 끊기 전에 — 끊고 나면 값이 흔들릴 수 있다).
    let periodEnd = null;
    try {
      const { data: sub } = await supabaseAdmin
        .from('subscriptions').select('current_period_end').eq('user_id', user.id).maybeSingle();
      periodEnd = (sub && sub.current_period_end) || null;
    } catch (_) { /* 조회 실패는 '남은 기간 없음' 으로 본다 */ }

    const hasPaidTimeLeft = !!periodEnd && new Date(periodEnd).getTime() > Date.now();

    // 1) 결제부터 멈춘다 (환불하지 않는다).
    const cancelRes = await cancelProviderSubscription(supabaseAdmin, user.id);
    if (!cancelRes.ok) {
      console.error('[withdraw] 구독 해지 실패 — 탈퇴 중단:', user.id, cancelRes.message);
      sendTextToTelegramSafe('🚨 탈퇴 중 구독 해지 실패 — 수동 확인 필요 user=' + user.id + ' / ' + (cancelRes.message || ''));
      return res.status(409).json({
        message: '결제 해지에 실패해 탈퇴를 진행하지 못했습니다. contact@pap-magazine.com 으로 연락 주시면 바로 처리해 드리겠습니다.',
        code: 'subscription_cancel_failed',
      });
    }

    // 2) 남은 기간이 있고 본인이 포기하지 않았다면 — 예약 탈퇴.
    //    접근권(profiles.subscription_plan/status)은 건드리지 않는다. 그대로 쓴다.
    if (hasPaidTimeLeft && mode !== 'now') {
      const { error } = await supabaseAdmin.from('profiles').update({
        withdraw_requested_at: new Date().toISOString(),
        withdraw_delete_after: periodEnd,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id);
      if (error) throw new Error(error.message);

      console.log('[withdraw] 예약 탈퇴 user:', user.id, 'until:', periodEnd, 'subscription:', cancelRes.action);
      return res.status(200).json({
        ok: true,
        scheduled: true,
        accessUntil: periodEnd,
        subscriptionCancel: cancelRes.action,
      });
    }

    // 3) 남은 기간이 없거나 본인이 즉시 삭제를 택함 — 지금 지운다.
    await hardDelete(user.id);
    console.log('[withdraw] 즉시 삭제 user:', user.id, 'mode:', mode, 'subscription:', cancelRes.action);
    return res.status(200).json({ ok: true, scheduled: false, subscriptionCancel: cancelRes.action });
  } catch (e) {
    console.error('[withdraw] 실패:', e.message);
    return res.status(500).json({ message: '탈퇴 처리에 실패했습니다. contact@pap-magazine.com 으로 연락 주세요.' });
  }
};
