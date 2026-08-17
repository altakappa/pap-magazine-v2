/**
 * 크론이 도중에 죽으면 아무 기록도 안 남던 것 (2026-08-10 사고).
 *
 * ── 무슨 일이 있었나 ────────────────────────────────────────────────
 * weekly-news · trend-scout 는 2026-07-06 등록 이후 **34일간 cron_runs 기록이
 * 0건**이었다. 등록이 안 된 것도, Vercel 크론 한도에 잘린 것도 아니다
 * (대시보드에 43개 전부 활성으로 있다). 런타임 로그의 실제 모습:
 *
 *     GET /api/cron/weekly-news 504
 *     Vercel Runtime Timeout Error: Task timed out after 120 seconds
 *
 * 기록이 finally 의 INSERT 하나뿐이라, **함수가 상한에서 잘리면 그 INSERT 도
 * 같이 죽는다.** 그래서 흔적이 안 남았다.
 *
 * 더 나쁜 건 감시까지 눈이 멀었다는 점이다. cron-duration 감시는 cron_runs 의
 * duration 을 읽는데 행이 없으면 볼 수가 없다 — **죽은 크론일수록 안 보인다.**
 * (cronDurationHealth.js 머리말이 이미 "도중에 죽으면 나 죽었다를 기록할
 *  주체가 없다"고 적어 뒀다. 이 커밋이 그 나머지 절반이다.)
 *
 * ── 왜 애초에 못 들어갔나 (산수) ────────────────────────────────────
 *   weekly-news : RSS 15s + 마스터 최대 90s + 번역 최대 90s = 최대 195s
 *   trend-scout : RSS 15s + Claude 채점 100s = 115s + DB 쓰기
 *   함수 상한은 120s. weekly-news 는 최선의 경우(135s)에도 못 들어간다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① cronGuard 가 시작을 먼저 기록할 것 (안 끝난 실행 = duration_ms null)
 *   ② 진행중 행이 실패 알림 쿨다운을 삼키지 않을 것
 *   ③ 시작 기록이 실패해도 크론이 죽지 않을 것 (예전 INSERT 로 폴백)
 *   ④ 끝나지 않은 실행을 감시가 읽고 알릴 것
 *   ⑤ 두 크론에 시간 예산이 있을 것 · 상한에 붙은 고정 타임아웃이 없을 것
 *   ⑥ maxDuration 을 이 둘만 올릴 것 (전체를 올리지 말 것)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('instagramImport.js', {
  listRecentMedia: async () => [],
  isLikelyEditorialCaption: () => false,
  _extractShortcode: () => null,
});
stub('cronGuard.js', { withCronGuard: (_name, fn) => fn });

const GUARD = fs.readFileSync(path.join(ROOT, 'api/_lib/cronGuard.js'), 'utf8');
const WN = fs.readFileSync(path.join(ROOT, 'api/cron/weekly-news.js'), 'utf8');
const TS = fs.readFileSync(path.join(ROOT, 'api/cron/trend-scout.js'), 'utf8');
const watch = require(path.join(ROOT, 'api/cron/pipeline-watch.js'));

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 240)); }
}
const code = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const GUARD_C = code(GUARD), WN_C = code(WN), TS_C = code(TS);

console.log('\n=== ① 시작을 먼저 기록한다 ===');
t('_logStart 가 있다', /async function _logStart\(/.test(GUARD_C));
t('핸들러 실행 전에 부른다',
  GUARD_C.indexOf('await _logStart(cronName)') > 0
  && GUARD_C.indexOf('await _logStart(cronName)') < GUARD_C.indexOf('await handler(req, res)'));
t('시작 행은 duration_ms = null', /_logStart[\s\S]{0,400}duration_ms: null/.test(GUARD_C),
  'null 이어야 "안 끝남" 을 구분할 수 있다');
t('시작 행은 ok = false (안 끝나면 그대로 실패로 남는다)',
  /_logStart[\s\S]{0,400}ok: false/.test(GUARD_C));
t('종료 시 그 행을 갱신한다', /async function _logFinish\(/.test(GUARD_C) && /\.eq\('id', rowId\)/.test(GUARD_C));

console.log('\n=== ② 진행중 행이 알림 쿨다운을 삼키지 않는다 ===');
t("_hasRecentAlert 가 duration_ms null 을 제외한다",
  /_hasRecentAlert[\s\S]{0,600}\.not\('duration_ms', 'is', null\)/.test(GUARD),
  '제외 안 하면 시작 행이 진짜 실패 알림을 막는다');

console.log('\n=== ③ 시작 기록 실패해도 크론은 돈다 ===');
t('_logStart 가 예외를 삼키고 null 을 준다',
  /_logStart[\s\S]{0,600}catch \(e\)[\s\S]{0,200}return null;/.test(GUARD_C));
t('startId 가 없으면 예전 INSERT 로 폴백한다',
  /if \(startId\) logged = await _logFinish/.test(GUARD_C)
  && /if \(!logged\) await _logRun\(/.test(GUARD_C));

console.log('\n=== ④ 끝나지 않은 실행을 감시가 읽는다 ===');
t('judgeDeadRuns 를 내보낸다', typeof watch.judgeDeadRuns === 'function');
if (typeof watch.judgeDeadRuns === 'function') {
  const none = watch.judgeDeadRuns([], {});
  t('없으면 정상', none.healthy === true && none.status === 'ok' && none.total === 0, JSON.stringify(none));

  /* ── 개수가 아니라 비율로 가른다 (2026-08-10 개정) ──────────────────
   * 첫 실물 포착에서 드러난 문제. 실측:
   *   sync-instagram  311회 실행 · 죽음 1 · 사망률 0.32% → 다음 회차 정상
   *   weekly-news     주 1회 · 죽음 1 · 사망률 100%      → 34일 성공 0
   * 개수로는 둘 다 '1건' 이라 구분이 안 된다. 그래서 0.32% 짜리에 🚨 가 떴고,
   * 그런 알림이 반복되면 진짜 고장을 놓친다 — 오늘 종일 고친 그 함정이다. */
  const noisy = watch.judgeDeadRuns(
    [{ cron_name: 'sync-instagram', ran_at: '2026-08-10T08:20:33Z' }],
    { 'sync-instagram': 310 });
  t('성공이 많고 1회만 죽으면 안 울린다 (일시적)',
    noisy.healthy === true && noisy.status === 'transient', JSON.stringify(noisy));
  t('그래도 기록·응답에는 남는다 (안 울림 ≠ 안 보임)',
    noisy.total === 1 && noisy.transient.length === 1 && noisy.alarming.length === 0);
  t('사유에 사망률을 적는다', /사망률/.test(noisy.reason), noisy.reason);

  const fatal = watch.judgeDeadRuns(
    [{ cron_name: 'weekly-news', ran_at: '2026-08-09T21:30:00Z' }],
    { 'weekly-news': 0 });
  t('창 안 성공이 0이면 1건이라도 울린다',
    fatal.healthy === false && fatal.status === 'dead' && fatal.alarmTotal === 1, JSON.stringify(fatal));
  t('사유에 "창 안 성공 0" 을 밝힌다', /창 안 성공 0/.test(fatal.reason), fatal.reason);

  const worsening = watch.judgeDeadRuns(
    [{ cron_name: 'x', ran_at: '2026-08-10T01:00:00Z' },
     { cron_name: 'x', ran_at: '2026-08-10T02:00:00Z' }],
    { x: 500 });
  t('성공이 많아도 2회 이상 죽으면 울린다 (악화 감지)',
    worsening.healthy === false && worsening.alarming.length === 1, JSON.stringify(worsening));

  const mixed = watch.judgeDeadRuns(
    [{ cron_name: 'weekly-news', ran_at: '2026-08-09T21:30:00Z' },
     { cron_name: 'sync-instagram', ran_at: '2026-08-10T08:20:33Z' }],
    { 'weekly-news': 0, 'sync-instagram': 310 });
  t('섞여 있으면 울릴 것만 골라 센다',
    mixed.healthy === false && mixed.total === 2 && mixed.alarmTotal === 1
    && mixed.alarming[0].cron === 'weekly-news', JSON.stringify(mixed));

  const dirty = watch.judgeDeadRuns([{ ran_at: '2026-08-09T21:30:00Z' }, null], {});
  t('이름 없는 행은 무시한다', dirty.total === 0, JSON.stringify(dirty));
}
t('알림 문안이 있다', typeof watch.buildDeadRunAlert === 'function');
if (typeof watch.buildDeadRunAlert === 'function') {
  const a = watch.buildDeadRunAlert({ total: 2, alarmTotal: 2, reason: 'x', crons: [], alarming: [] }, 'https://s');
  t('제목에 건수가 들어간다', /2건/.test(a.title), a.title);
  t('504·함수 상한을 볼 곳으로 알려준다', a.lines.join(' ').includes('504'));
}
const WATCH_SRC = fs.readFileSync(path.join(ROOT, 'api/cron/pipeline-watch.js'), 'utf8');
t('감시가 배선돼 있다', /const deadRuns = await checkDeadRuns\(/.test(WATCH_SRC));
/* 2026-08-17: 원래 /deadRuns \}\);/ 로 '응답의 맨 끝' 을 봤는데, 감시가
   하나 더 붙자(failingCrons) 깨졌다. 지키려던 건 위치가 아니라
   '응답 객체에 실린다' 이므로 그것만 본다. */
t('응답에 포함된다', /return res\.status\(200\)\.json\(\{[^}]*\bdeadRuns\b/.test(WATCH_SRC));
t('유예가 함수 상한보다 넉넉하다 (정상 실행을 죽었다고 부르지 않는다)',
  /CRON_DEAD_GRACE_MIN \|\| 5/.test(WATCH_SRC));
t('같은 창의 성공 횟수를 세어 넘긴다',
  /judgeDeadRuns\(rows \|\| \[\], okCounts\)/.test(WATCH_SRC)
  && /\.eq\('ok', true\)\.gte\('ran_at', since\)/.test(WATCH_SRC),
  '비율 판정의 분모가 없으면 개수 판정으로 되돌아간다');

console.log('\n=== ⑤ 두 크론에 시간 예산 ===');
for (const [name, src] of [['weekly-news', WN_C], ['trend-scout', TS_C]]) {
  t(name + ': BUDGET_MS 가 있다', /const BUDGET_MS = /.test(src));
  t(name + ': msLeft 로 남은 시간을 본다', /const msLeft = \(\) =>/.test(src));
  t(name + ': 예산 부족 시 죽지 않고 사유를 남긴다', /skipped: 'budget'/.test(src));
}
t('weekly-news: 마스터가 번역 몫을 남긴다', /msLeft\(\) - 90000 - SLACK_MS/.test(WN_C));
t('weekly-news: 고정 90초 번역 타임아웃이 사라졌다',
  !/masterJson, 6000, 90000/.test(WN_C), '남은 예산에 맞춰 깎아야 한다');
t('trend-scout: 고정 100초 Claude 타임아웃이 사라졌다',
  !/AbortSignal\.timeout\(100000\)/.test(TS_C));

console.log('\n=== ⑥ maxDuration — 이 둘만 올린다 ===');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const fns = cfg.functions || {};
for (const k of ['api/cron/weekly-news.js', 'api/cron/trend-scout.js']) {
  t(k + ' 가 300초', fns[k] && fns[k].maxDuration === 300, JSON.stringify(fns[k]));
}
t('전체 기본값은 120초 그대로다',
  fns['api/**/*.js'] && fns['api/**/*.js'].maxDuration === 120,
  '전부 올리면 폭주 함수의 비용·영향이 커진다');
t('예산이 상한보다 작다 (넘기 전에 스스로 접는다)',
  (Number((WN_C.match(/WEEKLY_NEWS_BUDGET_MS \|\| (\d+)/) || [])[1]) || 0) < 300000
  && (Number((TS_C.match(/TREND_SCOUT_BUDGET_MS \|\| (\d+)/) || [])[1]) || 0) < 300000);

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ cron-dead-run tests passed');
