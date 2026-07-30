/**
 * 발행 페이스 판정 (2026-07-30 신설, 도메니코 지적으로 규칙 변경).
 *
 * 왜 별도 파일인가 — 이 파일은 아무것도 require 하지 않는다:
 *   판정 로직이 growthAudit.js 안에 있으면, 테스트가 그걸 불러오는 순간
 *   growthAudit → _lib/supabase → createClient() 가 import 시점에 실행된다.
 *   그러면 DB 없이 규칙만 검증할 수 없고, 실제로 CI 를 깨뜨렸다:
 *   Node 20 에는 전역 WebSocket 이 없어 supabase 클라이언트 생성이
 *   "Node.js detected but native WebSocket not found." 로 죽는다(Node 22 는 있음).
 *   로컬은 통과하고 CI 만 죽는, 오늘 두 번째 같은 종류의 사고였다.
 *   → 순수 규칙은 의존 없는 파일로 분리한다. backfillHealth 와 같은 방식.
 *
 * 규칙이 바뀐 이유: 필름·에디토리얼은 서브미션(투고)이 들어와야 만드는 채널이다.
 * 투고가 없는 주에 0건인 것은 정상 운영이지 고장이 아니다. 그런데 고정 주간
 * 할당량만 보고 판정하니 films_pace 가 매일 '긴급' 으로 떴다. 매일 뜨는 긴급은
 * 사람이 대시보드 전체를 안 믿게 만든다 — 참여지표 MIN_WOW 때와 같은 실수다
 * (2026-07-25). 그래서 '만들 거리가 있었는데 못 냈는가' 를 본다.
 */
'use strict';

/**
 * @param {number} last7        최근 7일 발행 수
 * @param {number} prev7        직전 7일 발행 수(문구용)
 * @param {number} weeklyTarget 주간 목표
 * @param {number|null} waiting 대기 소재 수. null 이면 공급 개념이 없는 채널
 *                              (기사 = IG 자동수입)이라 목표만으로 판정한다.
 * @returns {{status:string, note:string}}
 */
function judgePace({ last7, prev7, weeklyTarget, waiting }) {
  const base = `이번 주 ${last7} vs 지난주 ${prev7} (목표 주 ${weeklyTarget})`;
  if (last7 >= weeklyTarget) return { status: 'ok', note: base };

  const below = last7 >= Math.ceil(weeklyTarget / 2) ? 'warn' : 'fail';
  if (waiting == null) return { status: below, note: base };

  if (waiting === 0) {
    return {
      status: 'ok',
      note: `${base} — 대기 중인 소재 0건. 서브미션 기반 채널이라 공급이 없으면 미발행이 정상이다.`,
    };
  }
  return { status: below, note: `${base} — 대기 소재 ${waiting}건이 있는데 못 나갔다.` };
}

module.exports = { judgePace };
