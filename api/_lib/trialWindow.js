'use strict';
/**
 * 무료체험(트라이얼) 창 계산 공용 모듈 — 2026-08-03
 *
 * 왜 만들었나:
 *   무료 7일 체험 기간에 풀레터·서브미션 피드백 같은 "유료 결과물"만 받아가고
 *   결제 직전 해지하는 어뷰징을 막으려면, 여러 화면(풀레터 관리, 서브미션 관리,
 *   구독 관리, 크론 메일)이 "이 회원이 지금 체험 중인가 / 결제까지 며칠 남았나"를
 *   똑같은 규칙으로 판단해야 한다. 규칙이 흩어지면 화면마다 다른 답이 나온다.
 *
 * 핵심 규칙 2가지:
 *   1) DB에 trial_end 컬럼이 없다. 대신 구독 주기 길이로 판정한다.
 *      status='active' 이고 (current_period_end - current_period_start) < 10일이면 체험.
 *      실제 유료 주기는 약 30일(월) 또는 365일(년)이라 10일 경계로 안전하게 갈린다.
 *   2) DB는 UTC로 저장한다. 한국 날짜(달력일)로 말하려면 9시간을 더한 뒤
 *      getUTC*로 읽는다. D-N은 "절대 시간차의 올림"이 아니라 "달력일 번호의 차"다.
 *      (예: 오늘 23시 → 내일 01시는 시간차 2시간이지만 D-1이 맞다.)
 */

const KST_MS = 9 * 60 * 60 * 1000;
const KST_DOW = ['일', '월', '화', '수', '목', '금', '토'];

// 체험으로 간주하는 주기 상한(일). 유료 주기(30/365일)와 확실히 구분된다.
const TRIAL_MAX_DAYS = 10;

function kstShift(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return new Date(t + KST_MS);
}

// 한국 달력일 번호(1970-01-01 KST = 0). 날짜 차이 계산의 기준.
function kstDayNo(iso) {
  const d = kstShift(iso);
  return d ? Math.floor(d.getTime() / 86400000) : null;
}

function kstDateStr(iso) {
  const d = kstShift(iso);
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function kstTimeStr(iso) {
  const d = kstShift(iso);
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function kstWeekday(iso) {
  const d = kstShift(iso);
  return d ? KST_DOW[d.getUTCDay()] : null;
}

// 오늘(한국 기준) 달력일 번호.
function todayKstDayNo(now) {
  const t = (now instanceof Date ? now.getTime() : (now || Date.now()));
  return Math.floor((t + KST_MS) / 86400000);
}

function periodDays(a, b) {
  if (!a || !b) return null;
  const d = (new Date(b) - new Date(a)) / 86400000;
  return isFinite(d) ? d : null;
}

/**
 * 구독 1건을 분류한다.
 * @param {object} sub  subscriptions 행 (status, current_period_start, current_period_end)
 * @param {Date|number} [now]
 * @returns {{kind:string, isTrial:boolean, periodDays:number|null,
 *            chargeAt:string|null, chargeDateKst:string|null,
 *            chargeTimeKst:string|null, chargeWeekdayKst:string|null,
 *            daysToCharge:number|null, label:string|null}}
 */
function classifyPeriod(sub, now) {
  const s = sub || {};
  const status = String(s.status || '').toLowerCase();
  const days = periodDays(s.current_period_start, s.current_period_end);

  let kind;
  if (status === 'canceled') kind = 'canceled';
  else if (status === 'past_due') kind = 'past_due';
  else if (status === 'paused') kind = 'paused';
  else if (status === 'active' && days != null && days > 0 && days < TRIAL_MAX_DAYS) kind = 'trialing';
  else if (status === 'active') kind = 'paying';
  else kind = status || 'unknown';

  const isTrial = kind === 'trialing';
  const endDayNo = kstDayNo(s.current_period_end);
  const todayNo = todayKstDayNo(now);
  const daysToCharge = (endDayNo == null) ? null : (endDayNo - todayNo);

  let label = null;
  if (isTrial) {
    if (daysToCharge == null) label = '무료체험 중';
    else if (daysToCharge > 0) label = `무료체험 중 · 전환 D-${daysToCharge}`;
    else if (daysToCharge === 0) label = '무료체험 중 · 오늘 전환';
    else label = '무료체험 종료(전환 대기)';
  }

  return {
    kind,
    isTrial,
    periodDays: days,
    chargeAt: s.current_period_end || null,
    chargeDateKst: kstDateStr(s.current_period_end),
    chargeTimeKst: kstTimeStr(s.current_period_end),
    chargeWeekdayKst: kstWeekday(s.current_period_end),
    daysToCharge,
    label,
  };
}

// 한 회원의 구독 중 "가장 대표적인" 1건을 고른다.
// 활성(active)을 최우선, 그다음 최근에 만들어진 것.
function pickPrimary(rows) {
  const list = (rows || []).slice();
  if (!list.length) return null;
  list.sort((a, b) => {
    const aA = String(a.status || '').toLowerCase() === 'active' ? 1 : 0;
    const bA = String(b.status || '').toLowerCase() === 'active' ? 1 : 0;
    if (aA !== bA) return bA - aA;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  return list[0];
}

/**
 * 여러 회원의 체험 정보를 한 번에 조회한다(N+1 쿼리 방지).
 * @param {object} db      supabaseAdmin
 * @param {string[]} userIds
 * @returns {Promise<Object<string, object>>} userId → classifyPeriod 결과
 */
async function trialInfoByUserIds(db, userIds) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  const out = {};
  if (!db || !ids.length) return out;
  try {
    const { data, error } = await db
      .from('subscriptions')
      .select('user_id, status, current_period_start, current_period_end, plan, created_at')
      .in('user_id', ids);
    if (error || !data) return out;
    const byUser = {};
    for (const row of data) {
      if (!row || !row.user_id) continue;
      (byUser[row.user_id] = byUser[row.user_id] || []).push(row);
    }
    for (const uid of Object.keys(byUser)) {
      const primary = pickPrimary(byUser[uid]);
      if (primary) out[uid] = classifyPeriod(primary);
    }
  } catch (_) { /* 조회 실패 시 배지만 안 붙는다 — 기능은 막지 않는다 */ }
  return out;
}

/** 한 명만 조회하는 축약형. */
async function trialInfoForUser(db, userId) {
  if (!userId) return null;
  const map = await trialInfoByUserIds(db, [userId]);
  return map[userId] || null;
}

/**
 * 과거 구독 이력이 있는지(= 재체험 차단 판정용).
 * 체험이든 유료든 subscriptions 행이 하나라도 있으면 "이력 있음".
 * @returns {Promise<boolean>}
 */
async function hasPriorSubscription(db, userId) {
  if (!db || !userId) return false;
  try {
    const { data, error } = await db
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch (_) { return false; }
}

module.exports = {
  KST_MS,
  TRIAL_MAX_DAYS,
  kstShift,
  kstDayNo,
  kstDateStr,
  kstTimeStr,
  kstWeekday,
  todayKstDayNo,
  periodDays,
  classifyPeriod,
  trialInfoByUserIds,
  trialInfoForUser,
  hasPriorSubscription,
};
