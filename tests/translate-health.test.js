/**
 * 번역 백필 정체 감시 회귀 (2026-07-31 신설).
 *
 * 왜 필요했나 — 오늘 실측:
 *   es 는 7/24, ja 는 7/22 이후 한 건도 안 늘었는데 아무도 몰랐다.
 *   크론은 10분마다 성실히 돌았고 cron_runs 에 전부 ok 로 기록됐다.
 *   저장만 0건이었다. "돌았다" 와 "생산했다" 는 다르다.
 *
 * 서술문 백필에서 같은 교훈을 이미 배웠는데(_lib/backfillHealth.js) 번역에는
 * 안 붙여뒀다. 이 테스트가 지키는 것: **생산량 기준으로 판정할 것**, 그리고
 * '완주' 와 '정체' 를 절대 뭉뚱그리지 말 것 — 둘 다 생산 0으로 보인다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { judgeTranslateHealth, buildTranslateAlert } = require('../api/_lib/translateHealth');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

console.log('\n=== 생산 0건이라도 원인이 다르다 ===');
(function () {
  const done = judgeTranslateHealth({ remaining: 0, producedInWindow: 0, windowHours: 3, runsInWindow: 18 });
  t('잔량 0 + 생산 0 = 완주 (장애 아님)', done.status === 'done',
    '완주를 정체로 읽으면 매시간 헛알림이 울린다');

  const stalled = judgeTranslateHealth({ remaining: 9000, producedInWindow: 0, windowHours: 3, runsInWindow: 18 });
  t('잔량 있음 + 생산 0 = 정체', stalled.status === 'stalled',
    '이게 7/22~7/31 열흘간 아무도 모른 채 지나간 그 상태다');
  t('실행은 했는데 생산이 0인 걸 구분해 알려준다', /18회 실행/.test(stalled.reason), stalled.reason);

  const noRuns = judgeTranslateHealth({ remaining: 9000, producedInWindow: 0, windowHours: 3, runsInWindow: 0 });
  t('실행 자체가 없으면 볼 곳이 다르다고 말한다', /크론 등록/.test(noRuns.reason), noRuns.reason);
})();

console.log('=== 생산이 있으면 속도로 판정 ===');
(function () {
  const ok = judgeTranslateHealth({ remaining: 1000, producedInWindow: 300, windowHours: 3 });
  t('정상', ok.status === 'ok');
  t('시간당 생산량 계산', ok.perHour === 100, '실제=' + ok.perHour);
  t('완주 ETA 계산', ok.etaHours === 10, '실제=' + ok.etaHours);

  const slow = judgeTranslateHealth({ remaining: 19500, producedInWindow: 30, windowHours: 3 });
  t('하루 넘게 걸리면 slow', slow.status === 'slow', slow.reason);
  t('slow 는 정체가 아니다 (알림 대상 아님)', slow.status !== 'stalled',
    '느린 건 설정 문제지 장애가 아니다 — 매번 울리면 진짜 정체 알림이 묻힌다');
})();

console.log('=== 0으로 나누지 않는다 ===');
(function () {
  const r = judgeTranslateHealth({ remaining: 100, producedInWindow: 0, windowHours: 0 });
  t('창 길이 0 이어도 죽지 않는다', r && typeof r.status === 'string');
  t('생산 0 이면 ETA 는 null (∞ 대신)', r.etaHours === null);
  const empty = judgeTranslateHealth({});
  t('인자가 비어도 죽지 않는다', empty.status === 'done');
})();

console.log('=== 알림 문안은 다음 행동을 담는다 ===');
(function () {
  const d = judgeTranslateHealth({ remaining: 9000, producedInWindow: 0, windowHours: 3, runsInWindow: 18 });
  const a = buildTranslateAlert(d, 'https://x.test');
  t('제목에 무슨 일인지', /정체/.test(a.title));
  t('어디를 볼지 알려준다 (cron_runs.note)', a.lines.some(l => /cron_runs/.test(l)),
    '알림만 오고 볼 곳을 모르면 또 하루가 간다');
  t('흔한 원인을 함께 준다', a.lines.some(l => /SEO_TRANSLATE_LANGS|429|타임아웃/.test(l)));
})();

console.log('=== 감시가 실제로 연결돼 있는가 ===');
(function () {
  const w = fs.readFileSync(path.join(__dirname, '..', 'api/cron/pipeline-watch.js'), 'utf8');
  t('pipeline-watch 가 번역도 본다', /checkTranslate\(/.test(w),
    '판정 함수만 만들고 호출을 안 붙이면 아무 일도 안 일어난다');
  t('알림 키를 분리했다', /TRANSLATE_ALERT_KEY/.test(w),
    '한쪽 쿨다운이 다른 쪽 알림을 삼키면 안 된다');
  t('감시가 죽어도 본 크론은 계속 돈다', /translate health 실패/.test(w));

  const lib = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/translateHealth.js'), 'utf8');
  t('판정 규칙은 의존 없는 파일 (DB 없이 검증 가능)', !/require\(/.test(lib));

  t('IDLE_NOTE 를 한 곳에서만 정의한다', /const IDLE_NOTE = '처리 대상 없음'/.test(lib),
    '문구가 두 벌이면 분모가 조용히 틀어진다');
  const cron = fs.readFileSync(path.join(__dirname, '..', 'api/cron/backfill-translations.js'), 'utf8');
  t('크론이 그 상수를 가져다 쓴다 (문자열을 복사하지 않는다)',
    /IDLE_NOTE \} = require\('\.\.\/_lib\/translateHealth'\)/.test(cron)
    && /\|\| IDLE_NOTE;/.test(cron) && !/\|\| '처리 대상 없음'/.test(cron));
  t('감시가 note 를 읽어 대기 실행을 센다 (count 만 세지 않는다)',
    /idleRunsInWindow/.test(w) && /includes\(IDLE_NOTE\)/.test(w),
    '대기 실행이 분모에 섞이면 정상이 정체로 읽힌다');
})();

/* ── 2026-09-12 — 분모에서 '할 일 없던 실행' 을 뺀다 ─────────────────────
   실측. 7일간 672회 실행 중 589회(88%)가 '처리 대상 없음' 이었다. 이 크론은
   새 기사가 들어올 때만 일하므로 대기가 정상이다. 그런데 옛 규칙이 그 589회를
   전부 분모에 넣어 "실행당 1건도 못 만든다" 고 울렸다. 09-12 실측으로는
   12회 중 10회가 대기, 실제 작업 2회에 13건 저장이었고 번역물도 7개 언어
   전부 있었다. 정상인데 정체로 잡힌 것이다.
   아래 두 테스트가 경계를 고정한다 — 한쪽만 있으면 다시 무너진다. */
(() => {
  console.log('\n=== 대기 실행은 분모가 아니다 ===');

  t('대기가 대부분이면 정체로 부르지 않는다 (헛알림 차단)', (() => {
    const d = judgeTranslateHealth({
      remaining: 6, producedInWindow: 8, windowHours: 3,
      runsInWindow: 12, idleRunsInWindow: 10,   // 일감 있던 실행 2회
    });
    return d.status !== 'stalled';
  })(), '09-12 헛알림이 그대로 재발한다');

  t('일감이 있었는데 못 만들면 여전히 정체다 (감시를 약하게 만든 게 아니다)', (() => {
    /* 2026-08-02 실제 사고 재현: 3시간 90회 실행에 저장 8건, 전부 일감 있었음. */
    const d = judgeTranslateHealth({
      remaining: 9000, producedInWindow: 8, windowHours: 3,
      runsInWindow: 90, idleRunsInWindow: 0,
    });
    return d.status === 'stalled';
  })(), '08-02 사고를 이제 놓친다 — 분모를 좁힌 게 지나쳤다');

  t('정체 문구에 대기 제외 사실이 적힌다 (사람이 분모를 확인할 수 있게)', (() => {
    const d = judgeTranslateHealth({
      remaining: 9000, producedInWindow: 8, windowHours: 3,
      runsInWindow: 95, idleRunsInWindow: 5,
    });
    return d.status === 'stalled' && /일감 있던 90회/.test(d.reason) && /대기 5회 제외/.test(d.reason);
  })());

  t('idleRunsInWindow 를 안 주면 옛 동작 그대로 (호출부 호환)', (() => {
    const d = judgeTranslateHealth({
      remaining: 9000, producedInWindow: 8, windowHours: 3, runsInWindow: 90,
    });
    return d.status === 'stalled';
  })());

  t('대기를 빼도 표본이 크면 판정한다 · 작으면 판정하지 않는다', (() => {
    const big = judgeTranslateHealth({ remaining: 100, producedInWindow: 3, windowHours: 3,
      runsInWindow: 30, idleRunsInWindow: 10 });          // 일감 20회 → 판정
    const small = judgeTranslateHealth({ remaining: 100, producedInWindow: 3, windowHours: 3,
      runsInWindow: 30, idleRunsInWindow: 25 });          // 일감 5회 → 표본 부족
    return big.status === 'stalled' && small.status !== 'stalled';
  })(), '표본 부족인데 장애로 부르면 헛알림이다');

  t('잔량 0 은 대기 수와 무관하게 완주', (() => {
    const d = judgeTranslateHealth({ remaining: 0, producedInWindow: 0, windowHours: 3,
      runsInWindow: 12, idleRunsInWindow: 12 });
    return d.status === 'done';
  })());
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ translate-health tests FAILED'); process.exit(1); }
console.log('✅ translate-health tests passed');
