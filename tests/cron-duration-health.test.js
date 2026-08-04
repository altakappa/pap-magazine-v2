/**
 * 크론 실행시간 감시 회귀 (2026-08-04 신설).
 *
 * 왜 필요했나 — 오늘 실측:
 *   backfill-translations 가 6시간 동안 22번 Vercel 의 120초 상한에 걸려
 *   강제종료됐다. 그런데 cron_runs 의 실패는 **0건**이었다. 도중에 잘려
 *   죽은 함수는 "나 죽었다" 를 기록할 주체가 없기 때문이다. 남는 기록은
 *   ok=true 로 끝난 짧은 실행들뿐이고, 성공률 지표는 평화로워 보였다.
 *
 * 이 프로젝트가 같은 것을 세 번 배웠다 — 서술문 백필, 번역 백필, FAQ 백필.
 * '돌았다' 는 '해냈다' 가 아니다. 이번엔 그 축이 하나 더 늘었다: '끝까지
 * 돌았다' 도 아니다. 그래서 이 감시만은 성공/실패가 아니라 **시간**을 본다.
 *
 * 이 테스트가 지키는 것:
 *   ① 상한에 붙은 크론을 찾아낼 것 (비율 기준, 표본이 적으면 침묵)
 *   ② 잘려 죽은 실행이 표에 없다는 사실을 경보문이 사람에게 말해줄 것
 *   ③ 정상 크론을 범인으로 지목하지 말 것 — 헛알림은 감시를 죽인다
 */
'use strict';
const {
  summarizeDurations, judgeCronDuration, buildCronDurationAlert,
  FN_LIMIT_MS, MIN_RUNS_TO_JUDGE,
} = require('../api/_lib/cronDurationHealth');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

/** 같은 크론 이름으로 n회 × ms 의 행을 만든다. */
function runs(name, n, ms) {
  return Array.from({ length: n }, () => ({ cron_name: name, duration_ms: ms }));
}

console.log('\n=== 요약: 크론별로 묶고 상한 근접 횟수를 센다 ===');
(function () {
  const rows = [].concat(
    runs('backfill-translations', 20, 110000),
    runs('backfill-translations', 10, 40000),
    runs('sync-instagram', 30, 3000),
  );
  const sum = summarizeDurations(rows);
  const tr = sum.find(s => s.name === 'backfill-translations');
  const ig = sum.find(s => s.name === 'sync-instagram');
  t('크론별로 묶인다', sum.length === 2, JSON.stringify(sum));
  t('표본 수를 센다', tr.runs === 30, 'runs=' + tr.runs);
  t('상한(102초) 넘긴 횟수만 센다', tr.over === 20, 'over=' + tr.over);
  t('최대·평균을 남긴다', tr.maxMs === 110000 && tr.avgMs === Math.round((20 * 110000 + 10 * 40000) / 30),
    JSON.stringify(tr));
  t('짧게 끝나는 크론은 0회', ig.over === 0, 'over=' + ig.over);
  t('위험한 순으로 정렬된다', sum[0].name === 'backfill-translations', sum.map(s => s.name).join(','));
})();

console.log('=== 잘못된 행을 조용히 걸러낸다 ===');
(function () {
  const sum = summarizeDurations([
    { cron_name: null, duration_ms: 110000 },
    { cron_name: 'a', duration_ms: null },
    { cron_name: 'a', duration_ms: -5 },
    { cron_name: 'a', duration_ms: 'x' },
    { cron_name: 'a', duration_ms: 5000 },
  ]);
  t('이름 없는 행·숫자 아닌 값은 버린다', sum.length === 1 && sum[0].runs === 1, JSON.stringify(sum));
  t('빈 입력에도 안 터진다', summarizeDurations(null).length === 0);
})();

console.log('=== 판정: 상한에 붙은 크론이 있는가 ===');
(function () {
  const bad = judgeCronDuration(summarizeDurations(
    [].concat(runs('backfill-translations', 22, 118000), runs('backfill-translations', 5, 60000))));
  t('상한 근접 비율이 높으면 이상', bad.healthy === false && bad.status === 'over-budget', bad.status);
  t('범인 이름을 지목한다', bad.worst === 'backfill-translations', bad.worst);
  t('경보 사유에 회수·비율·최대시간이 들어간다',
    /27회 중 22회/.test(bad.reason) && /81%/.test(bad.reason) && /118초/.test(bad.reason), bad.reason);

  const ok = judgeCronDuration(summarizeDurations(runs('sync-instagram', 30, 4000)));
  t('멀쩡한 크론은 건강하다', ok.healthy === true && ok.status === 'ok', ok.status + ' / ' + ok.reason);
  t('멀쩡할 때 범인은 없다', !ok.offenders.length);
})();

console.log('=== 표본이 적으면 판단하지 않는다 ===');
(function () {
  const few = judgeCronDuration(summarizeDurations(runs('rare-cron', MIN_RUNS_TO_JUDGE - 1, 119000)));
  t('표본 미달이면 unknown', few.status === 'unknown' && few.healthy === true, few.status);
  t('판단 대상이 0이라고 밝힌다', few.judged === 0, 'judged=' + few.judged);

  const enough = judgeCronDuration(summarizeDurations(runs('rare-cron', MIN_RUNS_TO_JUDGE, 119000)));
  t('표본이 차면 그때 판정한다', enough.status === 'over-budget', enough.status);
})();

console.log('=== 아직 비율은 낮지만 상한을 넘긴 적이 있다 ===');
(function () {
  const near = judgeCronDuration(summarizeDurations(
    [].concat(runs('some-cron', 1, FN_LIMIT_MS + 500), runs('some-cron', 29, 5000))));
  t('한 번 넘긴 건 관찰만 한다(경보 아님)', near.status === 'near-limit' && near.healthy === true, near.status);
  t('그래도 이름은 남긴다', near.worst === 'some-cron', near.worst);
})();

console.log('=== 경보 문안 ===');
(function () {
  const d = judgeCronDuration(summarizeDurations(
    [].concat(runs('backfill-translations', 22, 118000), runs('backfill-translations', 5, 60000),
              runs('backfill-faq', 10, 105000), runs('backfill-faq', 10, 30000))));
  const a = buildCronDurationAlert(d, 'https://www.pap-magazine.com');
  t('pushAlert 모양을 그대로 돌려준다',
    a && typeof a.title === 'string' && Array.isArray(a.lines) && typeof a.url === 'string',
    JSON.stringify(Object.keys(a || {})));
  const body = a.lines.join('\n');
  t('사유가 본문에 들어간다', body.includes(d.reason));
  t('같은 증상의 다른 크론도 알려준다', /backfill-faq/.test(body), body);
  t('"실패로 안 남는다" 는 사실을 사람에게 말해준다',
    /실패로 남지 않습니다/.test(body),
    '이 한 줄이 없으면 다음 사람도 성공률만 보고 정상이라 판단한다');
  t('무엇을 볼지까지 적는다', /호출/.test(body) && /마감시각/.test(body), body);
})();

console.log('\n' + (fail ? '✗ ' + fail + '건 실패' : '✓ 전부 통과') + ' (' + pass + '/' + (pass + fail) + ')');
process.exit(fail ? 1 : 0);
