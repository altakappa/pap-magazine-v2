'use strict';
/**
 * 공용 등급 유틸 — 웹훅·게이트·체크아웃이 회원등급을 일관되게 다루도록 단일화.
 *
 * 2026-07-20 감사 후속. 해소하는 결함:
 *   - 게이트가 subscription_plan만 보고 subscription_status를 무시(past_due·해지·
 *     suspended 회원이 유료 접근 유지)하던 과다부여.
 *   - 레일별 강등 비대칭: Paddle은 해지 시 plan=free로 내리지만 PortOne은 status만
 *     내려 해지회원이 접근을 유지하던 문제 → downgradeToFree로 통일.
 *
 * 진실원천: 원본 플랜키는 subscriptions.plan(예 'standard_monthly')에 보존하고,
 * profiles.subscription_plan에는 항상 base plan('free'|'standard'|'premium')만 쓴다.
 */

// 원본 플랜키('standard_monthly' 등) → 게이트가 인식하는 base plan.
function basePlanFromPlanKey(plan) {
  const s = String(plan || '').toLowerCase();
  if (/^premium/.test(s)) return 'premium';
  if (/^standard/.test(s)) return 'standard';
  return 'free';
}

// 등급 계층 (게이트 최소요건 비교용)
const TIER_RANK = { free: 0, standard: 1, premium: 2 };

// 활성 상태로 인정하는 subscription_status 집합.
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * 서버측 게이트 판정: profile이 minTier 이상 & 상태가 active인가.
 * @param {{subscription_plan?:string, subscription_status?:string}} profile
 * @param {'standard'|'premium'} minTier
 */
function hasActivePlan(profile, minTier) {
  if (!profile) return false;
  const base = basePlanFromPlanKey(profile.subscription_plan);
  const rank = TIER_RANK[base] || 0;
  const need = TIER_RANK[minTier] || 0;
  const statusOk = ACTIVE_STATUSES.has(String(profile.subscription_status || '').toLowerCase());
  return rank >= need && statusOk;
}

function hasActivePremium(profile) { return hasActivePlan(profile, 'premium'); }

/**
 * 구독 강등(해지·환불·빌링키삭제·만료 등). 게이트가 plan을 보므로 plan까지 free로 내린다.
 * @param {object} db      supabaseAdmin
 * @param {string} userId
 */
async function downgradeToFree(db, userId) {
  if (!userId) return { error: 'no_user' };
  const { error } = await db.from('profiles').update({
    subscription_plan: 'free',
    subscription_status: 'inactive',
  }).eq('id', userId);
  return { error };
}

module.exports = {
  basePlanFromPlanKey,
  hasActivePlan,
  hasActivePremium,
  downgradeToFree,
  TIER_RANK,
  ACTIVE_STATUSES,
};
