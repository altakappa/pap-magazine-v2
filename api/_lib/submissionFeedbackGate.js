'use strict';
/**
 * 서브미션 등급 혜택 두 가지의 서버 판정 — 도메니코 2026-09-12 ("셋 다 해줘").
 *
 *  1) 심사 피드백(admin_notes)은 **스탠다드 이상**만 본다.
 *     /subscribe 가 2026-07 부터 "서브미션 탈락 시 피드백 제공 = 스탠다드 이상" 으로 팔았는데
 *     mine.js 가 select('*') 로 전 등급에게 admin_notes 를 내려줬다(게이트 없음). 이제 무료 회원에게는
 *     본문을 비우고 feedbackLocked=true 만 준다. 단, status='revision'(보완 요청)의 메모는 "무엇을 고쳐라"
 *     지시라 숨기면 재제출을 할 수 없다 → 등급과 무관하게 보여준다.
 *  2) 심사 대기(pending) 중 자기 수정은 **프리미엄만**. 보완 요청(revision)은 관리자가 시킨 것이라 누구나.
 *     약관 제3조·가이드라인("제출 후 수정은 프리미엄만")과 코드를 맞춘다.
 */
const { hasActivePlan } = require('./subscriptionAccess');

async function loadPlan(supabaseAdmin, userId) {
  if (!userId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('profiles').select('subscription_plan, subscription_status').eq('id', userId).maybeSingle();
    return data || null;
  } catch (_) { return null; }
}

function canSeeFeedback(profile) { return hasActivePlan(profile, 'standard'); }
function canSelfEditPending(profile) { return hasActivePlan(profile, 'premium'); }

/** 회원에게 내려주기 직전의 행 가공. admin 이 보는 경로에는 쓰지 않는다. */
function shapeForOwner(row, profile) {
  if (!row) return row;
  const seeFeedback = canSeeFeedback(profile) || row.status === 'revision';
  const out = Object.assign({}, row);
  if (!seeFeedback) out.admin_notes = null;
  out.feedbackLocked = !seeFeedback && !!(row.admin_notes && String(row.admin_notes).trim());
  out.canSelfEdit = row.status === 'revision' || (row.status === 'pending' && canSelfEditPending(profile));
  out.selfEditBlockedReason = (row.status === 'pending' && !canSelfEditPending(profile)) ? 'not_premium' : null;
  return out;
}

module.exports = { loadPlan, canSeeFeedback, canSelfEditPending, shapeForOwner };
