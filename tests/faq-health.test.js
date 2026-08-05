/**
 * FAQ 백필 감시 규칙 회귀 (2026-08-04 신설).
 *
 * 왜 이 파일이 있나 ──────────────────────────────────────────────────
 * backfill-faq 는 10분마다 성실히 돌면서 매번 ok=true 를 남겼다. 실제 생산은
 * 0건이었다. 잔여 260건의 맨 앞 12건이 전부 본문 62~78자짜리 사진 게시물이었고,
 * 옛 fetchPending 이 LIMIT 을 먼저 걸고 나중에 걸렀기 때문에 매 실행이 그
 * 12건에 걸려 빈손으로 돌아왔다. 크론은 그걸 '대상 없음 — 완주' 라고 보고했다.
 *
 * 같은 교훈을 서술문(backfillHealth)과 번역(translateHealth)에서 이미 두 번
 * 배웠다. **"돌았다 ≠ 생산했다."** FAQ 에만 그 감시가 없어서 세 번째로 같은
 * 침묵을 겪었다. 이 테스트는 그 감시가 다시 벙어리가 되지 않게 지킨다.
 *
 * 특히 중요한 두 축 ──
 *   ① 진짜 정체(선별 벽·생산 0)를 놓치지 않는다   → 침묵 재발 방지
 *   ② 정상 상태에 헛알림을 울리지 않는다          → 알림 신뢰 유지
 * ②를 소홀히 하면 ①이 울려도 아무도 안 본다. 둘은 한 몸이다.
 *
 * 이 모듈은 아무것도 require 하지 않는다 — DB·네트워크 없이 규칙만 본다.
 *
 * Run with `node tests/faq-health.test.js` (npm test 에 연결됨).
 */
'use strict';

const {
  judgeFaqHealth, buildFaqAlert, parseFaqNote, summarizeFaqRuns, MIN_RUNS_TO_JUDGE,
} = require('../api/_lib/faqHealth');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------------------------------------------------------------- */
section('parseFaqNote — 요약 한 줄의 해석');

ok('생산 건수를 읽는다', parseFaqNote('FAQ 7/10 · 잔여 227').produced === 7);
ok('배치 크기도 읽는다', parseFaqNote('FAQ 7/10 · 잔여 227').batch === 10);
ok('실패가 붙어도 읽는다', parseFaqNote('FAQ 3/10 · 잔여 200 · 실패 7').produced === 3);
ok('완주는 done', parseFaqNote('FAQ 0 · 완주').kind === 'done');
ok('실질 완주도 done',
  parseFaqNote('FAQ 0 · 완주 (잔여 26건은 본문 80자 미만)').kind === 'done');
ok('막힘은 wall',
  parseFaqNote('FAQ 0 · 대상 없음 — 앞 60건이 전부 본문 80자 미만 (잔여 234)').kind === 'wall');
ok('모르는 문장은 parsed=false', parseFaqNote('무언가 다른 말').parsed === false);
ok('null 도 안전', parseFaqNote(null).parsed === false);
ok('공백은 잘라낸다', parseFaqNote('  FAQ 2/5 · 잔여 3  ').produced === 2);

section('summarizeFaqRuns — 창 안의 합계');

const sum = summarizeFaqRuns([
  'FAQ 5/10 · 잔여 220', 'FAQ 3/10 · 잔여 225', 'FAQ 0 · 완주',
  'FAQ 0 · 대상 없음 — 앞 60건이 전부 본문 80자 미만 (잔여 234)', null, '엉뚱한 말',
]);
ok('생산 합계', sum.produced === 8);
ok('전체 실행 수는 그대로', sum.total === 6);
ok('읽어낸 줄만 분모', sum.parsed === 4);
ok('완주 횟수', sum.done === 1);
ok('막힘 횟수', sum.wall === 1);

/* ---------------------------------------------------------------- */
section('놓치지 않아야 할 것 — 진짜 정체');

/* 2026-08-04 실제 모양: 잔여 260, 18회 실행, 전부 '대상 없음'. */
const wallCase = judgeFaqHealth({
  remaining: 260, producedInWindow: 0, windowHours: 3,
  runsInWindow: 18, parsedRuns: 18, wallRuns: 18, doneRuns: 0,
});
ok('선별 벽을 잡는다', wallCase.status === 'stalled' && wallCase.healthy === false);
ok('원인을 선별로 짚는다', wallCase.cause === 'selector-wall');

/* 벽은 다른 어떤 신호보다 먼저 잡아야 한다 — 한 번이라도 섞이면 이미 고장이다. */
const mixed = judgeFaqHealth({
  remaining: 200, producedInWindow: 5, windowHours: 3,
  runsInWindow: 18, parsedRuns: 18, wallRuns: 1, doneRuns: 0,
});
ok('생산이 있어도 벽 한 번이면 잡는다', mixed.cause === 'selector-wall');

const noOutput = judgeFaqHealth({
  remaining: 100, producedInWindow: 0, windowHours: 3,
  runsInWindow: 18, parsedRuns: 18, wallRuns: 0, doneRuns: 0,
});
ok('표본이 충분한데 생산 0이면 잡는다', noOutput.cause === 'no-output' && !noOutput.healthy);

const noRuns = judgeFaqHealth({
  remaining: 100, producedInWindow: 0, windowHours: 3,
  runsInWindow: 0, parsedRuns: 0, wallRuns: 0,
});
ok('실행 자체가 없으면 잡는다', noRuns.cause === 'no-runs' && !noRuns.healthy);
ok('실행 없음이 벽보다 먼저 판정된다', noRuns.status === 'stalled');

/* ---------------------------------------------------------------- */
section('울리지 말아야 할 것 — 헛알림 방지');

ok('잔여 0이면 항상 정상',
  judgeFaqHealth({ remaining: 0, producedInWindow: 0, windowHours: 3, runsInWindow: 0 }).healthy === true);

const fresh = judgeFaqHealth({
  remaining: 100, producedInWindow: 0, windowHours: 3,
  runsInWindow: MIN_RUNS_TO_JUDGE - 1, parsedRuns: 3, wallRuns: 0,
});
ok('표본 부족이면 판정 보류', fresh.healthy === true && fresh.status === 'ok');

const notDeployed = judgeFaqHealth({
  remaining: 100, producedInWindow: 0, windowHours: 3,
  runsInWindow: 18, parsedRuns: 0, wallRuns: 0,
});
ok('요약 형식 배포 전이면 판정 보류', notDeployed.status === 'unknown' && notDeployed.healthy === true);

/* 남은 게 전부 사진 게시물이라 FAQ 를 만들 근거가 없는 상태.
   이건 일부러 남긴 바닥이지 정체가 아니다 — 여기서 울리면 영영 시끄럽다. */
const floor = judgeFaqHealth({
  remaining: 26, producedInWindow: 0, windowHours: 3,
  runsInWindow: 18, parsedRuns: 18, wallRuns: 0, doneRuns: 18,
});
ok('짧은 기사만 남은 바닥은 정상', floor.status === 'floor' && floor.healthy === true);

const slow = judgeFaqHealth({
  remaining: 5000, producedInWindow: 1, windowHours: 3, runsInWindow: 18, parsedRuns: 18,
});
ok('느린 건 장애가 아니다', slow.status === 'slow' && slow.healthy === true);

const healthy = judgeFaqHealth({
  remaining: 200, producedInWindow: 30, windowHours: 3, runsInWindow: 18, parsedRuns: 18,
});
ok('정상 생산은 ok', healthy.status === 'ok' && healthy.healthy === true);
ok('시간당 생산량을 계산한다', healthy.perHour === 10);
ok('완주 예상 시간을 낸다', healthy.etaHours === 20);

/* ---------------------------------------------------------------- */
section('알림 문안 — 원인마다 볼 곳이 다르다');

const a1 = buildFaqAlert(wallCase, 'https://x.test');
ok('벽은 선별 문제로 안내', /선별/.test(a1.title) && a1.lines.join('\n').indexOf('fetchPending') !== -1);
const a2 = buildFaqAlert(noOutput, 'https://x.test');
ok('생산 0은 크레딧·키부터 보게 한다', a2.lines.join('\n').indexOf('ANTHROPIC_API_KEY') !== -1);
const a3 = buildFaqAlert(noRuns, 'https://x.test');
ok('실행 없음은 크론 등록을 보게 한다', a3.lines.join('\n').indexOf('vercel.json') !== -1);
ok('사이트 주소를 쓴다', a1.url === 'https://x.test/admin');
ok('제목이 있다', typeof a1.title === 'string' && a1.title.length > 0);

/* ---------------------------------------------------------------- */
console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.error('❌ faq-health tests failed'); process.exit(1); }
console.log('✅ faq-health tests passed');
