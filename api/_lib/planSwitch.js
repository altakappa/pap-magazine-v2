/**
 * 플랜 변경 예약 (2026-10-12, 도메니코 "제대로 된 길로 가자")
 *
 * 문제: 스탠다드 이용자가 프리미엄 버튼을 누르면 새 PayPal 구독이 오늘 시작되고
 *       이미 낸 스탠다드 남은 날은 그냥 사라졌다(PayPal 구독은 일할 계산이 없다).
 * 해법: 활성 구독자가 다른 플랜을 고르면 새 구독의 start_time 을 현재 기간 종료일로
 *       넘긴다. 그 사이 subscriptions 행은 지금 플랜 그대로 두고 pending_* 에 예약만
 *       적는다. 첫 결제(PAYMENT.SALE.COMPLETED)가 오면 행을 새 플랜으로 바꾸고 비운다.
 *       이전 구독은 예약 시점에 PayPal 에서 해지한다(종료일에 둘 다 청구되는 것 방지).
 *       이미 낸 기간은 해지해도 그대로 쓴다(handleTermination 의 접근권 유지 규칙).
 *
 * 순수 함수만. DB/네트워크 없음 → 단위 테스트 가능.
 */

const MIN_LEAD_MS = 10 * 60 * 1000;   // 종료까지 10분도 안 남았으면 그냥 지금 시작

/** 행(subscriptions row)을 보고 "새 구독을 언제 시작해야 하나"를 돌려준다. 바로 시작이면 null. */
function switchStartTime(row, nowMs) {
  if (!row) return null;
  const st = String(row.status || '').toLowerCase();
  if (st !== 'active' && st !== 'past_due') return null;
  if (String(row.provider || 'paypal') !== 'paypal') return null;
  const end = row.current_period_end ? new Date(row.current_period_end).getTime() : NaN;
  if (!Number.isFinite(end)) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (end - now < MIN_LEAD_MS) return null;
  return new Date(end).toISOString();
}

/** 같은 플랜·같은 주기면 "변경"이 아니다(재구독 버튼 오클릭 방지). */
function isSamePlan(row, planKey) {
  if (!row || !planKey) return false;
  return String(row.plan || '') === String(planKey);
}

/** PayPal 구독 원본을 보고 "예약 시작(아직 결제 전, 시작일이 미래)"인지 판정. */
function isScheduledStart(sub, nowMs) {
  if (!sub) return false;
  const bi = sub.billing_info || {};
  if (bi.last_payment && bi.last_payment.time) return false;   // 이미 한 번 결제됨 → 즉시 시작
  const startIso = sub.start_time || bi.next_billing_time || null;
  if (!startIso) return false;
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return false;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return start - now > 60 * 1000;
}

/** 예약 정보 패치(행에 덮어쓸 값). */
function pendingPatch(sub, planKey) {
  const bi = (sub && sub.billing_info) || {};
  const startIso = (sub && sub.start_time) || bi.next_billing_time || null;
  return {
    pending_plan: planKey || 'unknown',
    pending_billing_cycle: /yearly$/.test(String(planKey || '')) ? 'yearly' : 'monthly',
    pending_paypal_subscription_id: sub && sub.id,
    pending_start_at: startIso ? new Date(startIso).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}

function clearPendingPatch() {
  return {
    pending_plan: null,
    pending_billing_cycle: null,
    pending_paypal_subscription_id: null,
    pending_start_at: null,
  };
}

module.exports = { MIN_LEAD_MS, switchStartTime, isSamePlan, isScheduledStart, pendingPatch, clearPendingPatch };
