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
 *              └ 상한은 2026-09-15 에 200초로 올렸다 (CAP_MS 주석 참조 — 문턱은 그대로)
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
   상한을 올리지 말고 배치를 줄인다(잘린 응답은 그 배치 전멸이다).

   ■ 'ai-search' 만 예외다 (2026-09-15 실측으로 100초 → 200초)
   위 문장("배치를 줄여라")은 **배치형 콜**에 맞는 말이다. FAQ 백필처럼 한 콜에
   8건을 묶는 쪽은 오래 걸리면 묶음을 줄이면 된다. 그런데 'ai-search' 를 쓰는
   유일한 곳(aiVisibility 의 SoV 프로브)은 **질문 하나 = 답 하나**라 줄일 배치가
   없다. 줄일 게 없는 일에 배치형 상한을 빌려 쓴 것이 이 칸이었다.

   그 결과 실측(회차 3번 전부): claude/search 8칸 중 4·4·6칸이 매주 같은 사유로
   죽었다 — 'The operation was aborted due to timeout'. 그런데 그 회차들의
   총 실행시간은 133초·120초·139초이고 **함수 예산은 270초**다. 즉 137초가
   매주 손도 안 댄 채 버려지는데 콜은 100초에서 잘리고 있었다.
   예산이 모자란 게 아니라 상한이 예산보다 먼저 잘랐다.

   200초인 이유: 최악의 경우(claude 8칸이 전부 200초를 다 써도) 남은 일꾼 2명이
   나머지 24칸을 돌 시간이 남는다(대략 200초 필요, 예산 270초). 240초까지
   올리면 회차가 maxDuration 300 에 붙는다. 그리고 **정말 200초도 모자란지**는
   추측하지 않는다 — aiVisibility 가 콜마다 경과 시간을 note 에 남기므로
   다음 회차의 숫자가 답한다. */
const CAP_MS = {
  ai: 55000,
  'ai-search': 200000,
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
