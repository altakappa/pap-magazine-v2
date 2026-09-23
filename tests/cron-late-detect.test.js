/**
 * 크론 지연 자동탐지 (2026-09-15 신설)
 *
 * 배경 — 실측:
 *   돌아가는 크론 52개 중 pipeline-watch 가 보던 건 21개. 2026-09-13~14 에 7건
 *   (tiktok-post·indexnow·trial-ending-reminder·daily-digest-email·ad-candidate-scan·
 *   weekly-briefing·image-link-check)이 에러 없이 실행 기록 자체가 없었고, 노트는
 *   내내 'checked 21 · missing 0 · healthy'. tiktok_posts 9/14 = 0행.
 *
 * 규칙 (9/14 12:00 되감기 시뮬레이션으로 확정):
 *   임계 = med + clamp(med×0.5, 30분, 6시간). 3배 규칙은 7건 중 1건만 탐지 → 폐기.
 *
 * 이 하네스가 지키는 것:
 *   (a) 이력 5회 미만 신규 크론은 알리지 않는다 (pullletter-editorial-reminder 2회)
 *   (b) 2분 주기 고빈도 크론은 30분 바닥이 적용돼 조용하다 (backfill-translations med 2분 → 임계 32분)
 *   (c) 부정기 크론은 제외 목록으로 뺀다 (trend-scout 오경보)
 *   (d) 이미 알린 크론은 상태로 중복 억제한다 (30분마다 같은 알림 방지)
 *   ⑤ 임계 표: 10분→40분 · 1시간→90분 · 매일→30시간 · 매주→7.25일
 *   ⑥ 9/14 12:00 되감기 — 스킵 7건 중 일·주 크론이 잡힌다 / 3배 규칙은 못 잡는다
 *   ⑦ 감시가 핸들러에 배선돼 있고 기본이 알림이다 (9/23 — 관찰 끝나고 켬)
 *   ⑧ 재알림 간격이 크론 주기에 비례한다 (주 크론이 닷새 내리 울지 않게)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const L = require(path.join(ROOT, 'api', '_lib', 'cronLateness.js'));

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', JSON.stringify(d)); }
}
const MIN = 60000, H = 3600000, D = 24 * H;
/** now 에서 거슬러 올라가며 periodMs 간격으로 n 회 실행한 이력. lastOffsetMs = 마지막 실행이 now 보다 얼마나 전인가 */
function hist(now, periodMs, n, lastOffsetMs) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(now - lastOffsetMs - i * periodMs).toISOString());
  return out;
}
const NOW = Date.parse('2026-09-14T12:00:00Z');

console.log('\n=== ⑤ 임계 표 (확정 규칙) ===');
{
  t('10분 크론 → 40분', L.lateThresholdSec(600) === 2400, L.lateThresholdSec(600));
  t('1시간 크론 → 90분', L.lateThresholdSec(3600) === 5400, L.lateThresholdSec(3600));
  t('매일 → 30시간', L.lateThresholdSec(86400) === 108000, L.lateThresholdSec(86400));
  t('매주 → 7.25일 (6시간 천장)', L.lateThresholdSec(604800) === 604800 + 21600, L.lateThresholdSec(604800));
  t('2분 크론 → 32분 (30분 바닥)', L.lateThresholdSec(120) === 1920, L.lateThresholdSec(120));
  t('med 없으면 null', L.lateThresholdSec(null) === null && L.lateThresholdSec(0) === null);
  t('중앙값은 percentile_disc 와 같다 (짝수면 아래값)', L.median([1, 2, 3, 4]) === 2 && L.median([5, 1, 3]) === 3);
}

console.log('\n=== (a) 이력 5회 미만은 알리지 않는다 ===');
{
  // pullletter-editorial-reminder: 실측 2회, med 2,444분. 마지막이 5일 전이어도 판단 안 함.
  const d = L.judgeLateCrons({ 'pullletter-editorial-reminder': hist(NOW, 2444 * MIN, 2, 5 * D) }, { now: NOW });
  t('2회 이력은 late 에 없다', d.late.length === 0, d);
  t('fewRuns 에 이름이 남는다', d.skipped.fewRuns.includes('pullletter-editorial-reminder'));
  t('checked 에 안 센다', d.checked === 0);
  const d4 = L.judgeLateCrons({ x: hist(NOW, D, 4, 5 * D) }, { now: NOW });
  t('4회도 아직 안 본다 (경계값)', d4.late.length === 0 && d4.skipped.fewRuns.includes('x'));
  const d5 = L.judgeLateCrons({ x: hist(NOW, D, 5, 5 * D) }, { now: NOW });
  t('5회부터 본다 (경계값)', d5.late.length === 1 && d5.checked === 1, d5);
  t('빈 입력·null 에 안 터진다', L.judgeLateCrons({}, { now: NOW }).checked === 0 && L.judgeLateCrons(null).checked === 0);
  t('이력이 비어 있어도 fewRuns', L.judgeLateCrons({ y: [] }, { now: NOW }).skipped.fewRuns.includes('y'));
}

console.log('\n=== (b) 2분 주기 고빈도 — 30분 바닥 ===');
{
  const h = hist(NOW, 2 * MIN, 8, 20 * MIN);   // 평소 2분, 지금 20분째 안 돎
  const d = L.judgeLateCrons({ 'backfill-translations': h }, { now: NOW });
  t('20분 늦어도 조용하다 (임계 32분)', d.late.length === 0, d);
  const d2 = L.judgeLateCrons({ 'backfill-translations': hist(NOW, 2 * MIN, 8, 33 * MIN) }, { now: NOW });
  t('33분이면 잡는다', d2.late.length === 1 && d2.late[0].thresholdMin === 32, d2.late);
  // 배수 규칙이었다면 6분(2분×3)에 울렸을 것 — 그게 고빈도 오경보의 원인이었다
  t('배수(3배) 규칙이면 6분에 울렸을 케이스', 20 * 60 > 120 * 3);
}

console.log('\n=== (c) 부정기 크론은 제외 목록 ===');
{
  // trend-scout: 월·목 21:00 → 간격 3일/4일. 4일 간격 뒤에 보면 med(3일)+6h 를 넘어 오경보.
  const ts = [];
  let cur = NOW - 4 * D + 9 * H;   // 마지막 실행 = 3.6일 전
  for (let i = 0; i < 8; i++) { ts.push(new Date(cur).toISOString()); cur -= (i % 2 ? 4 : 3) * D; }
  // 같은 모양의 크론을 제외 목록에 없는 이름으로 돌리면 오경보가 난다 — 그게 제외 목록이 필요한 이유
  const noEx = L.judgeLateCrons({ 'mon-thu-scout': ts }, { now: NOW });
  const withDefault = L.judgeLateCrons({ 'trend-scout': ts }, { now: NOW });
  t('제외 안 하면 오경보가 난다 (재현)', noEx.late.length === 1 && noEx.late[0].cron === 'mon-thu-scout', noEx);
  t('기본 제외 목록에 trend-scout 가 있다', L.DEFAULT_EXCLUDE.includes('trend-scout'));
  t('기본값으로 돌리면 조용하고 excluded 에 남는다', withDefault.late.length === 0 && withDefault.skipped.excluded.includes('trend-scout'), withDefault);
  const extra = L.judgeLateCrons({ foo: hist(NOW, D, 8, 3 * D) }, { now: NOW, exclude: ['foo'] });
  t('env 로 덧붙인 이름도 제외된다', extra.late.length === 0 && extra.skipped.excluded.includes('foo'));
  t('제외돼도 다른 크론은 그대로 본다',
    L.judgeLateCrons({ 'trend-scout': ts, bar: hist(NOW, D, 8, 3 * D) }, { now: NOW }).late[0].cron === 'bar');
}

console.log('\n=== (d) 이미 알린 크론은 중복 억제 ===');
{
  const judged = L.judgeLateCrons({ a: hist(NOW, D, 8, 2 * D), b: hist(NOW, D, 8, 2 * D) }, { now: NOW });
  t('둘 다 늦었다', judged.late.length === 2);
  const r1 = L.decideLateAlerts(judged, {}, { now: NOW, cooldownMs: 24 * H });
  t('처음엔 둘 다 알린다', r1.toAlert.length === 2, r1);
  t('상태에 알림 시각이 남는다', r1.nextState.late.a && r1.nextState.late.b);
  const r2 = L.decideLateAlerts(judged, r1.nextState, { now: NOW + 30 * MIN, cooldownMs: 24 * H });
  t('30분 뒤 같은 상태면 안 알린다', r2.toAlert.length === 0, r2);
  t('상태의 알림 시각은 그대로', r2.nextState.late.a === r1.nextState.late.a);
  const r3 = L.decideLateAlerts(judged, r1.nextState, { now: NOW + 25 * H, cooldownMs: 24 * H });
  t('쿨다운(24h) 지나면 다시 알린다', r3.toAlert.length === 2, r3);
  // a 가 돌아왔다 → 늦은 건 b 뿐
  const back = L.judgeLateCrons({ a: hist(NOW + H, D, 8, 10 * MIN), b: hist(NOW, D, 8, 2 * D) }, { now: NOW + H });
  const r4 = L.decideLateAlerts(back, r1.nextState, { now: NOW + H, cooldownMs: 24 * H });
  t('돌아온 크론은 recovered 에 실리고 상태에서 빠진다', r4.recovered.includes('a') && !('a' in r4.nextState.late), r4);
  t('아직 늦은 b 는 상태에 남고 다시 안 알린다', 'b' in r4.nextState.late && r4.toAlert.length === 0);
  t('상태가 깨져 있어도 안 터진다', L.decideLateAlerts(judged, { late: 'oops' }, { now: NOW }).toAlert.length === 2);
}

console.log('\n=== ⑥ 9/14 12:00 되감기 — 스킵 건이 잡힌다, 3배 규칙은 못 잡는다 ===');
{
  // 일 크론들: 9/13 의 정해진 시각에 돌았어야 했는데 안 돌았다 → 마지막 실행은 9/12
  const H12 = {
    'daily-digest-email': hist(NOW, D, 8, 36 * H + 20 * MIN),     // 9/13 23:40 스킵 → 마지막 9/12 23:40 = 36.3h 전
    'ad-candidate-scan': hist(NOW, D, 8, 36 * H + 40 * MIN),      // 9/13 23:20 스킵
    'trial-ending-reminder': hist(NOW, D, 8, 35 * H),             // 9/14 01:00 스킵 → 마지막 9/13 01:00
    'indexnow': hist(NOW, D, 8, 34 * H),                          // 9/14 02:00 스킵
    'weekly-briefing': hist(NOW, 7 * D, 8, 7 * D + 13 * H + 15 * MIN), // 9/13 22:45 스킵 → 마지막 9/06
    'image-link-check': hist(NOW, 7 * D, 8, 7 * D + 11 * H + 30 * MIN), // 9/14 00:30 스킵 → 마지막 9/07
    'sync-instagram': hist(NOW, 5 * MIN, 8, 3 * MIN),             // 정상
    'algo-coach': hist(NOW, H, 8, 20 * MIN),                      // 정상
  };
  const d = L.judgeLateCrons(H12, { now: NOW });
  const names = d.late.map((x) => x.cron);
  for (const n of ['daily-digest-email', 'ad-candidate-scan', 'trial-ending-reminder', 'indexnow', 'weekly-briefing', 'image-link-check']) {
    t('잡힌다: ' + n, names.includes(n), names);
  }
  t('정상 크론은 안 잡힌다', !names.includes('sync-instagram') && !names.includes('algo-coach'), names);
  t('가장 늦은 순으로 정렬', d.late[0].cron === 'image-link-check' || d.late[0].cron === 'weekly-briefing', names);
  // 3배 규칙이었다면: 일 크론 임계 72h → 34~36h 늦은 넷은 전부 놓친다
  const missedBy3x = ['daily-digest-email', 'ad-candidate-scan', 'trial-ending-reminder', 'indexnow']
    .filter((n) => { const x = d.late.find((y) => y.cron === n); return x && x.lateMin * 60 <= x.medMin * 60 * 3; });
  t('3배 규칙이면 일 크론 4건을 전부 놓쳤다 (폐기 근거)', missedBy3x.length === 4, missedBy3x);
  const a = L.buildLateAlert(d.late, 'https://x.test');
  t('알림 제목에 크론 이름과 건수', /크론이 제때 안 돌았다/.test(a.title) && /외 5건/.test(a.title), a.title);
  t('본문에 평소 주기와 임계가 실린다', /평소 주기 1\.0일, 임계 1\.3일/.test(a.lines.join('\n')), a.lines);
  t('링크는 크론 상태로', a.url === 'https://x.test/admin/crons');
}

console.log('\n=== ⑦ 배선 + 로그 전용 기본값 ===');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'), 'utf8');
  t('핸들러가 checkLateCrons 를 부른다', /const lateCrons = await checkLateCrons\(\{ dry \}\)/.test(src));
  t('cronLateness 를 ../_lib 로 require 한다', /require\('\.\.\/_lib\/cronLateness'\)/.test(src));
  t("기본 모드는 alert (env 가 'log' 일 때만 끈다)", /CRON_LATE_ALERT_MODE === 'log' \? 'log' : 'alert'/.test(src));
  t('끄는 스위치가 살아 있다 (CRON_LATE_ALERT_MODE)', /process\.env\.CRON_LATE_ALERT_MODE/.test(src));
  t('알림은 alert 모드에서만 나간다', /LATE_ALERT_MODE === 'alert' && decided\.toAlert\.length/.test(src));
  t('note 에 late 가 최상위로 실린다', /late: late\.map\(\(x\) => x\.cron\)/.test(src) && /lateDetail/.test(src));
  t('중복 억제 상태는 ops_alert_state 키로', /LATE_ALERT_KEY = 'cron-late-detect'/.test(src));
  t('로그 전용일 땐 알림 시각을 안 적는다', /LATE_ALERT_MODE === 'alert' \? decided\.nextState\.late : \{\}/.test(src));
  const vnames = L.cronNamesFromVercel(JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')));
  t('vercel.json 씨앗에 주 크론이 들어 있다', vnames.includes('weekly-briefing') && vnames.includes('image-link-check'), vnames);
  t('쿼리스트링·중복 경로는 하나로 합친다', vnames.filter((n) => n === 'sync-instagram').length === 1 && vnames.includes('indexnow'));
}

console.log('\n=== ⑧ 재알림 간격은 주기에 비례한다 (2026-09-23) ===');
{
  const BASE = 24 * H;
  t('10분 크론 → 바닥(24h)', L.realertCooldownMs({ medMin: 10 }, BASE) === BASE);
  t('일 크론 → 24h (바닥과 같다)', L.realertCooldownMs({ medMin: 1440 }, BASE) === D);
  t('주 크론 → 7일', L.realertCooldownMs({ medMin: 10080 }, BASE) === 7 * D);
  t('2주 크론도 천장 7일을 안 넘는다', L.realertCooldownMs({ medMin: 20160 }, BASE) === L.REALERT_CEIL_MS);
  t('medMin 이 없으면 바닥', L.realertCooldownMs({}, BASE) === BASE && L.realertCooldownMs(null, BASE) === BASE);
  t('medMin 이 0·음수여도 바닥', L.realertCooldownMs({ medMin: 0 }, BASE) === BASE && L.realertCooldownMs({ medMin: -5 }, BASE) === BASE);
  t('base 가 없으면 24h 로 본다', L.realertCooldownMs({ medMin: 10 }) === D);

  // 실측 재현: weekly-briefing 이 9/13 회차를 빠뜨려 닷새 동안 계속 늦은 상태
  const weekly = { 'weekly-briefing': hist(NOW, 7 * D, 8, 7 * D + 13 * H) };
  const j = L.judgeLateCrons(weekly, { now: NOW });
  t('주 크론이 늦은 걸로 잡힌다', j.late.length === 1 && j.late[0].medMin === 7 * 24 * 60, j.late);
  const a1 = L.decideLateAlerts(j, {}, { now: NOW, cooldownMs: BASE });
  t('처음엔 알린다', a1.toAlert.length === 1);
  let silent = 0;
  for (let day = 1; day <= 5; day++) {
    const jd = L.judgeLateCrons({ 'weekly-briefing': hist(NOW + day * D, 7 * D, 8, 7 * D + 13 * H + day * D) }, { now: NOW + day * D });
    const r = L.decideLateAlerts(jd, a1.nextState, { now: NOW + day * D, cooldownMs: BASE });
    if (!r.toAlert.length) silent++;
  }
  t('그 뒤 닷새는 조용하다 (종전 고정 24h 면 5건이 더 갔다)', silent === 5, silent);

  // 일 크론은 종전과 똑같이 하루 뒤 다시 알린다 — 비례가 기존 동작을 깎지 않는다
  const daily = L.judgeLateCrons({ 'daily-digest-email': hist(NOW, D, 8, 36 * H) }, { now: NOW });
  const d1 = L.decideLateAlerts(daily, {}, { now: NOW, cooldownMs: BASE });
  const daily2 = L.judgeLateCrons({ 'daily-digest-email': hist(NOW + 25 * H, D, 8, 61 * H) }, { now: NOW + 25 * H });
  const d2 = L.decideLateAlerts(daily2, d1.nextState, { now: NOW + 25 * H, cooldownMs: BASE });
  t('일 크론은 25시간 뒤 다시 알린다 (종전 동작 보존)', d1.toAlert.length === 1 && d2.toAlert.length === 1, { d1: d1.toAlert.length, d2: d2.toAlert.length });

  // 돌아오면 상태에서 빠지므로 다음 지연은 쿨다운과 무관하게 즉시 알린다
  const back = L.judgeLateCrons({ 'weekly-briefing': hist(NOW + H, 7 * D, 8, 10 * MIN) }, { now: NOW + H });
  const r4 = L.decideLateAlerts(back, a1.nextState, { now: NOW + H, cooldownMs: BASE });
  t('돌아오면 recovered 로 빠진다', r4.recovered.includes('weekly-briefing') && !('weekly-briefing' in r4.nextState.late), r4);
  const again = L.decideLateAlerts(j, r4.nextState, { now: NOW + 2 * H, cooldownMs: BASE });
  t('다시 늦으면 쿨다운 안 기다리고 알린다', again.toAlert.length === 1, again);
}

console.log(`\n크론 지연 자동탐지: ${pass} 통과 · ${fail} 실패`);
if (fail) process.exit(1);
