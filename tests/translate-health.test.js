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
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ translate-health tests FAILED'); process.exit(1); }
console.log('✅ translate-health tests passed');
