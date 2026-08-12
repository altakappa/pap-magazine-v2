/**
 * admin_notes 한 칸에 두 가지가 섞여 있다 — 갈라 준다. (2026-08-12)
 *
 * ■ 무슨 일이 있었나
 *   서브미션 애드온(€110 / €220) 결제에는 전용 컬럼이 없다. 그래서
 *   api/submissions/paypal-capture.js 가 `submissions.admin_notes` 끝에
 *   "[2026-08-12] PayPal 애드온 결제: ig_images_cover €220 (order 5AB...)"
 *   같은 줄을 덧붙여 남긴다. 이게 우리 DB 에 남는 **유일한** 애드온 결제 기록이다.
 *
 *   그런데 같은 칸을 심사자가 손으로 쓰는 심사 메모도 쓴다.
 *   api/submissions/[id]/review.js 는 심사 저장 때 admin_notes 를 **통째로
 *   덮어썼다.** 심사 의견을 안 쓰고 저장하면 빈 문자열로 덮여 더 깨끗하게 사라진다.
 *   즉 €220 결제 기록이 심사 버튼 한 번에 증발했다. 8/14 에 Paddle 대시보드가
 *   닫히면 대조할 장부도 없다.
 *
 * ■ 규칙
 *   "[YYYY-MM-DD] PayPal ..." / "[YYYY-MM-DD] Paddle ..." 로 시작하는 줄은
 *   **기계가 쓴 결제 기록**이다. 사람이 지우거나 덮을 수 없다.
 *   나머지는 사람이 쓴 심사 메모다. 자유롭게 고칠 수 있다.
 *
 *   근본 해법은 결제 이력 전용 테이블이다. 이건 그때까지의 최소 방어선이다.
 */

'use strict';

/** 기계가 쓴 결제 기록 줄 */
const PAYMENT_LINE_RE = /^\[\d{4}-\d{2}-\d{2}\]\s+(PayPal|Paddle)\b/;

/**
 * admin_notes 를 사람 메모와 결제 기록으로 나눈다.
 * @param {string|null} notes
 * @returns {{ human: string, payments: string[] }}
 */
function splitAdminNotes(notes) {
  const lines = String(notes == null ? '' : notes).split('\n');
  const payments = [];
  const human = [];
  for (const line of lines) {
    if (PAYMENT_LINE_RE.test(line.trim())) payments.push(line.trim());
    else human.push(line);
  }
  // 사람 메모 쪽의 앞뒤 빈 줄만 정리한다(가운데 줄바꿈은 작성자 의도다).
  while (human.length && human[0].trim() === '') human.shift();
  while (human.length && human[human.length - 1].trim() === '') human.pop();
  return { human: human.join('\n'), payments };
}

/**
 * 사람 메모를 새 값으로 바꾸되 결제 기록은 그대로 이어 붙인다.
 * @param {string|null} existingNotes  기존 admin_notes (DB 값)
 * @param {string|null} newHumanNote   심사자가 새로 쓴 메모
 * @returns {string}
 */
function mergeAdminNotes(existingNotes, newHumanNote) {
  const { payments } = splitAdminNotes(existingNotes);
  const human = String(newHumanNote == null ? '' : newHumanNote).trim();
  // 결제 기록은 항상 아래에 모아 둔다 — paypal-capture 도 끝에 덧붙인다.
  return [human, ...payments].filter((s) => s !== '').join('\n');
}

module.exports = { PAYMENT_LINE_RE, splitAdminNotes, mergeAdminNotes };
