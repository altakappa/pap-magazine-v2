'use strict';
/**
 * 연간 프리미엄 회원의 유료 서브미션(€380, paid_few_looks) 1회 면제 (도메니코 2026-09-13).
 *
 *   "연간 프리미엄에 €380 1회 면제(€790 은 제외)" — 구독 연도당 1회, 제출 시 자동 적용.
 *
 * 판정 규칙 (서버가 유일한 진실원천 — 폼의 안내는 GET /api/submissions/fee-waiver 로 같은 함수를 부른다):
 *   1) subscriptions 에 status active/trialing 이고 plan 이 premium_* 이며 billing_cycle 이 yearly
 *      (또는 plan 이 *_yearly) 인 행이 있어야 한다. profiles.subscription_plan 은 base plan('premium')만
 *      보관하므로 연/월 구분은 subscriptions 행에서만 알 수 있다.
 *   2) 그 구독의 current_period_start 이후에 payment_status='waived' 로 저장된 서브미션이 없어야 한다.
 *      (구독 연도 = current_period_start ~ current_period_end. 갱신되면 period_start 가 앞으로 가고 다시 1회.)
 *   3) 대상은 paid_few_looks(€380)만. branded(€790)는 면제하지 않는다.
 *
 * 면제된 건은 submissions.payment_status='waived' 로 저장되고 PayPal 승인 단계를 건너뛴다.
 * review.js 의 승인 게이트는 'awaiting_authorization' 만 막으므로 waived 는 통과하고,
 * settleAuthorization 은 paypal_authorization_id 가 없으면 skip 한다(청구 없음).
 *
 * 냉정한 실측(2026-09-13): 최근 180일 paid_few_looks 제출 2건, 실제 결제 0건, 연간 프리미엄 가입자 0명.
 * 이 장치는 매출을 깎지 않는다. "€380 상당" 이라는 문구가 연간 결제를 밀어주는 것이 목적이다.
 */

const { feeForType } = require('./submissionPayment');

const WAIVABLE_TYPES = new Set(['paid_few_looks', 'few_looks', 'fewlooks']);
const WAIVED_STATUS = 'waived';
const ACTIVE = new Set(['active', 'trialing']);

/** 구독 행 하나가 "연간 프리미엄 활성" 인가. 순수 함수(테스트용). */
function isYearlyPremiumRow(row) {
  if (!row) return false;
  const plan = String(row.plan || '').toLowerCase();
  const cycle = String(row.billing_cycle || '').toLowerCase();
  const status = String(row.status || '').toLowerCase();
  if (!/^premium/.test(plan)) return false;
  if (!ACTIVE.has(status)) return false;
  return cycle === 'yearly' || cycle === 'annual' || /_yearly$|_annual$/.test(plan);
}

/** 유형이 면제 대상(€380 소룩)인가. */
function isWaivableType(submissionType) {
  const key = String(submissionType == null ? '' : submissionType).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return WAIVABLE_TYPES.has(key) && feeForType(key) === 38000;
}

/**
 * 회원의 활성 연간 프리미엄 구독 행. 없으면 null. 조회 실패도 null(혜택은 확실할 때만).
 */
async function findYearlyPremiumSubscription(db, userId) {
  if (!db || !userId) return null;
  try {
    const { data } = await db
      .from('subscriptions')
      .select('id, plan, status, billing_cycle, current_period_start, current_period_end')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing']);
    const rows = Array.isArray(data) ? data.filter(isYearlyPremiumRow) : [];
    if (!rows.length) return null;
    // 여러 행이면 가장 최근 기간의 것
    rows.sort((a, b) => String(b.current_period_start || '').localeCompare(String(a.current_period_start || '')));
    return rows[0];
  } catch (_) { return null; }
}

/**
 * 이 구독 연도에 이미 면제를 썼는가 → 쓴 서브미션 행({id, created_at}) 또는 null.
 * period_start 가 없으면(옛 행) 구독 생성일도 없으니 "최근 365일" 로 본다.
 */
async function findWaiverUsed(db, userId, periodStartIso) {
  if (!db || !userId) return null;
  let since = periodStartIso;
  if (!since) since = new Date(Date.now() - 365 * 86400000).toISOString();
  try {
    const { data } = await db
      .from('submissions')
      .select('id, created_at, title')
      .eq('user_id', userId)
      .eq('payment_status', WAIVED_STATUS)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    return Array.isArray(data) && data.length ? data[0] : null;
  } catch (_) { return null; }
}

/**
 * 종합 판정. 유형을 주면 유형 조건까지, 안 주면 "자격만"(폼 안내용).
 * @returns {{eligible:boolean, reason:string, plan?:string, periodStart?:string, periodEnd?:string, usedAt?:string, usedId?:string}}
 *   reason: 'not_yearly_premium' | 'already_used' | 'type_not_waivable' | 'ok'
 */
async function checkFeeWaiver(db, userId, submissionType) {
  const sub = await findYearlyPremiumSubscription(db, userId);
  if (!sub) return { eligible: false, reason: 'not_yearly_premium' };
  const base = {
    plan: sub.plan,
    periodStart: sub.current_period_start || null,
    periodEnd: sub.current_period_end || null,
  };
  const used = await findWaiverUsed(db, userId, sub.current_period_start);
  if (used) {
    return Object.assign({ eligible: false, reason: 'already_used', usedAt: used.created_at, usedId: used.id }, base);
  }
  if (submissionType !== undefined && submissionType !== null && !isWaivableType(submissionType)) {
    return Object.assign({ eligible: false, reason: 'type_not_waivable' }, base);
  }
  return Object.assign({ eligible: true, reason: 'ok' }, base);
}

/** description 에 남길 면제 기록. */
function waiverRecord(check) {
  return {
    plan: check.plan || 'premium_yearly',
    periodStart: check.periodStart || null,
    periodEnd: check.periodEnd || null,
    amountCents: 38000,
    at: new Date().toISOString(),
  };
}

module.exports = {
  WAIVED_STATUS,
  isYearlyPremiumRow,
  isWaivableType,
  findYearlyPremiumSubscription,
  findWaiverUsed,
  checkFeeWaiver,
  waiverRecord,
};
