/**
 * 심사 결과에 따른 게재료 승인 정산 — 2026-08-12
 *
 * 승인(approved) → capture  : 💰 여기서 처음 돈이 빠진다
 * 거절(rejected) → void     : 청구 없음
 * 보완(revision) → void     : 청구 없음. 재제출 때 다시 승인받는다.
 *                             (남의 돈을 이유 없이 묶어두지 않는다 — 도메니코 승인)
 * 복구(pending)  → 그대로   : 심사를 되돌린 것이므로 손대지 않는다.
 *
 * ■ 이 함수는 review.js 가 submissions 를 이미 갱신한 뒤에 불린다
 *   심사 상태 저장과 돈 정산을 한 트랜잭션으로 묶을 수 없다(PayPal 은 외부다).
 *   그래서 순서를 "상태 먼저, 돈 나중" 으로 잡았다 — 반대로 하면 캡처는 됐는데
 *   심사 상태가 안 바뀌는, 훨씬 설명하기 어려운 상태가 생긴다.
 *
 * ■ 실패는 전부 알린다
 *   캡처 실패 = 게재는 확정됐는데 돈을 못 받은 상태.
 *   보이드 실패 = 떨어뜨렸는데 남의 돈이 묶여 있는 상태.
 *   둘 다 사람이 개입해야 한다. 조용히 넘기면 안 된다.
 */

'use strict';

const {
  captureAuthorization, voidAuthorization, isAlreadySettled,
} = require('./paypalAuthorizations');
const { feeForType, storedSubmissionType } = require('./submissionPayment');

/**
 * @param {object} db        supabaseAdmin
 * @param {object} sub       갱신된 submissions 행 (payment_status·paypal_authorization_id 포함)
 * @param {string} status    'approved' | 'rejected' | 'revision' | 'pending'
 * @param {function} notify  async (text) => void  — 반드시 await 되는 알림 함수
 */
async function settleSubmissionAuthorization(db, sub, status, notify) {
  const say = typeof notify === 'function' ? notify : async () => {};
  if (!sub) return { skipped: 'no_submission' };

  const authId = sub.paypal_authorization_id;
  const pay = String(sub.payment_status || '');

  // 승인이 없는 건 = 무료 유형이거나 구(舊) 경로. 손댈 것이 없다.
  if (!authId) return { skipped: 'no_authorization' };
  // 이미 정산이 끝난 건 (멱등) — 심사 저장을 두 번 눌러도 안전해야 한다.
  if (pay === 'paid') return { already: 'paid' };
  if (pay === 'voided') return { already: 'voided' };
  if (pay !== 'authorized') return { skipped: 'not_authorized:' + pay };

  // 심사를 되돌린 경우 — 묶인 상태를 유지한다. 다만 SLA 시계는 계속 간다.
  if (status === 'pending') return { skipped: 'recovery_hold' };

  const nowIso = new Date().toISOString();

  if (status === 'approved') {
    const cents = feeForType(storedSubmissionType(sub));
    if (!cents) {
      await say('🚨 승인했는데 금액을 산출할 수 없다 — 수동 확인 필요 submission=' + sub.id
        + ' auth=' + authId);
      return { error: 'cannot_price' };
    }
    // 멱등키 — 심사 저장이 두 번 눌려도 두 번 청구되지 않는다.
    const r = await captureAuthorization(authId, cents, 'pap-cap-' + sub.id);
    if (!r.ok) {
      if (r.code === 'AUTHORIZATION_ALREADY_CAPTURED' || r.code === 'PREVIOUSLY_CAPTURED') {
        // PayPal 은 이미 받았는데 우리 DB 만 안 바뀐 상태 — 맞춰 준다.
        await db.from('submissions').update({
          payment_status: 'paid', paid_amount: cents, payment_provider: 'paypal', updated_at: nowIso,
        }).eq('id', sub.id);
        return { captured: true, already: true };
      }
      await say('🚨 게재료 캡처 실패 — 게재는 승인됐는데 청구가 안 됐다\n'
        + 'submission=' + sub.id + ' auth=' + authId + ' code=' + (r.code || r.status)
        + '\n승인이 만료됐을 수 있습니다(2일 SLA 초과). 크리에이터에게 재결제를 요청해야 합니다.');
      return { error: 'capture_failed', code: r.code };
    }
    const { error: upErr } = await db.from('submissions').update({
      payment_status: 'paid',
      paid_amount: cents,
      payment_provider: 'paypal',
      updated_at: nowIso,
    }).eq('id', sub.id);
    if (upErr) {
      await say('🚨 캡처는 됐는데 DB 반영 실패 — 돈은 받았다. 수동 정정 필요\n'
        + 'submission=' + sub.id + ' capture=' + r.captureId + ' err=' + upErr.message);
      return { captured: true, error: 'db_write_failed' };
    }
    await say('💶 게재료 청구 완료 €' + (cents / 100).toFixed(2) + ' · submission=' + sub.id);
    return { captured: true, captureId: r.captureId };
  }

  if (status === 'rejected' || status === 'revision') {
    const r = await voidAuthorization(authId);
    if (!r.ok && !isAlreadySettled(r.code)) {
      await say('🚨 승인 보이드 실패 — 떨어뜨렸는데 크리에이터 돈이 묶여 있다\n'
        + 'submission=' + sub.id + ' auth=' + authId + ' code=' + (r.code || r.status)
        + '\nPayPal 에서 직접 void 해 주세요.');
      return { error: 'void_failed', code: r.code };
    }
    if (!r.ok && r.code === 'AUTHORIZATION_ALREADY_CAPTURED') {
      // 이미 청구된 건을 거절로 되돌린 것 — 환불이 필요하다. 자동으로 하지 않는다.
      await say('⚠️ 이미 청구된 건을 ' + status + ' 로 바꿨다 — 환불이 필요할 수 있다\n'
        + 'submission=' + sub.id + ' auth=' + authId);
      return { error: 'already_captured' };
    }
    const { error: upErr } = await db.from('submissions').update({
      payment_status: 'voided',
      authorization_voided_at: nowIso,
      updated_at: nowIso,
    }).eq('id', sub.id);
    if (upErr) {
      await say('⚠️ 보이드는 됐는데 DB 반영 실패 submission=' + sub.id + ' err=' + upErr.message);
      return { voided: true, error: 'db_write_failed' };
    }
    return { voided: true };
  }

  return { skipped: 'unhandled_status:' + status };
}

module.exports = { settleSubmissionAuthorization };
