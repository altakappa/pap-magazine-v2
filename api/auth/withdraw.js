/**
 * POST /api/auth/withdraw — 회원 탈퇴 (본인)
 *
 * frontend/data-deletion.html 이 "마이페이지의 '회원 탈퇴' 메뉴를 통해 직접
 * 탈퇴하실 수도 있습니다" 라고 안내해 왔지만, 그 기능은 존재한 적이 없었다.
 * (2026-08-10 실측 — 해지 버튼과 같은 종류의 구멍)
 *
 * ■ 순서가 전부다
 *   1) 결제사 구독을 먼저 끊는다.  ← 이걸 빼면 회원은 사라지는데 결제는 계속된다
 *   2) 실패하면 탈퇴를 중단한다.   ← 돈이 계속 나가는 것보다 탈퇴가 안 되는 게 낫다
 *   3) 그 다음에 계정을 삭제한다.
 *
 * ■ 환불 정책 (2026-08-10 도메니코 확정)
 *   "이미 낸 한 달치는 환불하지 않는다. 구독 기간이 끝난 뒤로 재결제만 막는다."
 *   탈퇴는 환불 사유가 아니다. 이 엔드포인트는 환불을 하지 않는다.
 *   남은 유료 기간을 다 쓰고 싶은 사람은 '탈퇴'가 아니라 '구독 해지'를 써야
 *   하며, 프론트 확인창이 그 차이를 먼저 알려준다.
 *
 * ■ 삭제 범위
 *   관리자 삭제(api/admin/member-delete.js)와 같은 경로를 쓴다 — 새로운
 *   실패 모드를 만들지 않기 위해서다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuthStrict } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { cancelProviderSubscription } = require('../_lib/cancelProviderSubscription');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  // 되돌릴 수 없는 작업이라 token_version 까지 검증하는 strict 경로를 쓴다.
  const user = await requireAuthStrict(req, res);
  if (!user) return;

  // 오조작 방지 — 프론트가 명시적으로 confirm 을 보내야 한다.
  if (!req.body || req.body.confirm !== 'DELETE') {
    return res.status(400).json({ message: 'confirm required', code: 'confirm_required' });
  }

  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('id, email, role').eq('id', user.id).maybeSingle();
    if (!profile) return res.status(404).json({ message: 'Account not found' });

    // 관리자 계정은 셀프 탈퇴로 지우지 않는다 — 실수 한 번이 운영을 멈춘다.
    if (profile.role === 'admin') {
      return res.status(403).json({
        message: '관리자 계정은 마이페이지에서 탈퇴할 수 없습니다. 운영팀에 문의하세요.',
        code: 'admin_cannot_self_delete',
      });
    }

    // 1) 결제부터 멈춘다.
    const cancelRes = await cancelProviderSubscription(supabaseAdmin, user.id);
    if (!cancelRes.ok) {
      console.error('[withdraw] 구독 해지 실패 — 탈퇴 중단:', user.id, cancelRes.message);
      sendTextToTelegramSafe('🚨 탈퇴 중 구독 해지 실패 — 수동 확인 필요 user=' + user.id + ' / ' + (cancelRes.message || ''));
      return res.status(409).json({
        message: '결제 해지에 실패해 탈퇴를 진행하지 못했습니다. contact@pap-magazine.com 으로 연락 주시면 바로 처리해 드리겠습니다.',
        code: 'subscription_cancel_failed',
      });
    }

    // 2) 계정 삭제 (관리자 삭제와 동일 경로)
    const { error: profileError } = await supabaseAdmin.from('profiles').delete().eq('id', user.id);
    if (profileError) throw new Error(profileError.message);

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (authError) {
      // 프로필은 지워졌는데 auth 가 남으면 로그인은 되고 데이터는 없는 상태가 된다.
      console.error('[withdraw] profile 삭제됨 / auth 사용자 삭제 실패:', user.id, authError.message);
      sendTextToTelegramSafe('⚠️ 탈퇴: profiles 는 삭제됐으나 auth 사용자 삭제 실패 — 수동 정리 필요 user=' + user.id);
    }

    console.log('[withdraw] 완료 user:', user.id, 'subscription:', cancelRes.action);
    return res.status(200).json({ ok: true, subscriptionCancel: cancelRes.action });
  } catch (e) {
    console.error('[withdraw] 실패:', e.message);
    return res.status(500).json({ message: '탈퇴 처리에 실패했습니다. contact@pap-magazine.com 으로 연락 주세요.' });
  }
};
