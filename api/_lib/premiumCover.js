'use strict';
/**
 * 커버 이미지 선택 — 프리미엄 회원 혜택 (도메니코 2026-09-12).
 *   "실제로 서브미션 시 크리에이터가 프리미엄 회원일 때만 커버 이미지를 선택 가능하게.
 *    프리미엄이 아닌 크리에이터가 선택하려 하면 프리미엄 회원만 가능하다는 경고."
 * 종전엔 누구나 폼에서 골랐고, 별도로 €220 애드온(지정 이미지+커버)이 있었다. 둘 다 정리:
 * 폼은 프리미엄에게만 열리고(경고는 프론트), 서버는 여기서 다시 판정해 비프리미엄의 선택값을 0(첫 이미지)으로 되돌린다.
 * 폼을 우회해 API 로 보내도 통하지 않게 하는 마지막 자물쇠다.
 */
const { isPremiumProfile } = require('./collaborators');

/** profiles 한 줄로 프리미엄 여부. 조회 실패는 false(혜택은 확실할 때만). */
async function isPremiumUser(supabaseAdmin, userId) {
  if (!userId) return false;
  try {
    const { data } = await supabaseAdmin
      .from('profiles').select('subscription_plan, subscription_status').eq('id', userId).maybeSingle();
    return isPremiumProfile(data);
  } catch (_) { return false; }
}

/** 요청된 커버 인덱스 → 저장할 값. 프리미엄이 아니면 항상 0. 숫자가 아니거나 음수면 0. */
function resolveCoverIndex(requested, premium) {
  if (!premium) return 0;
  const n = Number(requested);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

module.exports = { isPremiumUser, resolveCoverIndex };
