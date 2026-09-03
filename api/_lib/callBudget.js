/**
 * callBudget.js — 크론 함수 예산 안에서 "이 콜을 시작해도 되나" (2026-09-03 신설)
 *
 * ■ 왜 만들었나 — 같은 버그를 하루에 세 번 밟았다
 * 크론은 maxDuration 이 있고, 그 안에서 외부 콜(Claude·OpenAI)을 여러 번 돈다.
 * 남은 시간이 한 콜보다 짧은데 **콜을 시작하면** 타임아웃으로 죽는다.
 * 돈은 나가고 데이터는 0이다 — 가장 나쁜 조합이다.
 *
 * 2026-08-28 실측, 세 곳에서 같은 모양:
 *   editorialFaqI18nBackfill  문턱 20초 → 'es The operation was aborted due to timeout'
 *   faqEnBackfill             문턱 20초 → 같은 자리에 잠복
 *   aiVisibility              상한 60초 → claude/search 8칸 중 4칸 타임아웃
 *
 * 세 곳이 각자 `Math.max(20000, deadline - Date.now() - 5000)` 를 손으로 썼다.
 * 규칙이 세 벌이면 한쪽만 고쳐진다(교훈 2). 그래서 여기 한 벌로 모은다.
 *
 * ■ 숫자의 근거 — 추측이 아니라 실측이다
 *   ai         35초  20초로는 콜을 시작만 하고 죽었다 (2026-08-28 'es')
 *   ai-search 100초  웹검색 콜은 60초를 넘는다 (2026-08-30 claude/search 4칸)
 *   db          5초  DB 왕복은 짧다. 넉넉히 잡으면 마지막 파도를 통째로 버린다
 *
 * ■ 쓰는 법
 *   const { canStart, budgetFor } = require('./callBudget');
 *   if (!canStart(deadline, 'ai')) break;              // 끝낼 수 없으면 시작 안 한다
 *   await call(prompt, budgetFor(deadline, 'ai'));     // 남은 예산을 넘지 않는다
 *
 * 못 돈 몫은 **다음 회차가 맡는다.** 크론은 10분마다 다시 온다 — 이번 회차에
 * 무리해서 태우는 것보다 다음 회차에 온전히 도는 쪽이 언제나 싸다.
 */

'use strict';

/* 한 콜을 끝내는 데 최소로 필요한 시간. 이보다 적게 남았으면 시작하지 않는다. */
const FLOOR_MS = {
  ai: 35000,
  'ai-search': 100000,
  db: 5000,
};

/* 한 콜에 줄 수 있는 최대치. 이보다 오래 걸리는 콜은 어차피 배치가 큰 것이다 —
   상한을 올리지 말고 배치를 줄인다(잘린 응답은 그 배치 전멸이다). */
const CAP_MS = {
  ai: 55000,
  'ai-search': 100000,
  db: 10000,
};

/* 콜이 끝난 뒤 저장·집계에 남겨 두는 여유. 0 으로 두면 콜은 성공하고
   그 결과를 쓰지 못한 채 함수가 죽는다. */
const RESERVE_MS = 5000;

function floorFor(kind) { return FLOOR_MS[kind] || FLOOR_MS.ai; }
function capFor(kind) { return CAP_MS[kind] || CAP_MS.ai; }

/**
 * 지금 이 종류의 콜을 시작해도 되나.
 * @param {number} deadline  Date.now() 기준 마감 시각(ms)
 * @param {string} kind      'ai' | 'ai-search' | 'db'
 * @param {number} [now]     테스트용 주입
 */
function canStart(deadline, kind = 'ai', now = Date.now()) {
  return (deadline - now) >= floorFor(kind);
}

/**
 * 이 콜에 줄 타임아웃(ms). canStart 가 true 일 때만 의미가 있다.
 * 남은 예산에서 마무리 여유를 뺀 값과 종류별 상한 중 작은 쪽.
 */
function budgetFor(deadline, kind = 'ai', now = Date.now()) {
  const left = deadline - now - RESERVE_MS;
  return Math.max(1000, Math.min(capFor(kind), left));
}

module.exports = { canStart, budgetFor, floorFor, capFor, FLOOR_MS, CAP_MS, RESERVE_MS };
