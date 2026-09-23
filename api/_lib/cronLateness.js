/**
 * 크론 지연 자동탐지 (2026-09-15 신설)
 *
 * 왜 — 돌아가는 크론 52개 중 pipeline-watch 가 보던 건 21개였다. 나머지 30개는
 * 안 돌아도 아무도 모른다. 2026-09-13~14 에 7건(tiktok-post·indexnow·
 * trial-ending-reminder·daily-digest-email·ad-candidate-scan·weekly-briefing·
 * image-link-check)이 에러 없이 실행 기록 자체가 없었고(tiktok_posts 9/14 = 0행),
 * 그동안 watch 노트는 'checked 21 · missing 0 · healthy' 였다. 조용히 빠졌다
 * 조용히 돌아왔고, 하루치 일은 영영 안 됐다.
 *
 * 원인은 감시 목록을 **손으로 적는 방식** 자체다(52개 중 21개만 적혀 있던 게 증거).
 * 그래서 목록을 적지 않는다 — cron_runs 이력에서 주기를 스스로 배워 늦으면 잡는다.
 *
 * 규칙 (2026-09-14 12:00 되감기 시뮬레이션으로 확정 — 바꾸지 말 것):
 *   임계 = med_gap + clamp(med_gap × 0.5, 30분, 6시간)      -- 초 단위
 *   지연 > med × 3 배수 규칙은 스킵 7건 중 1건만 잡았다 → 폐기.
 *   (일 크론은 med=1440분이라 3배면 3일 — 하루 빠져도 안 운다. 배수는 주기가
 *    길수록 무용지물이다.) clamp 규칙은 7건 전부 탐지, 오경보 49개 중 2건(4%).
 *   임계 결과: 10분 크론→40분 · 1시간→90분 · 매일→30시간 · 매주→7.25일.
 *
 * 이 파일은 순수 함수만 둔다 — DB·알림은 pipeline-watch 의 checkLateCrons 가 한다.
 * 그래야 하네스가 DB 없이 규칙의 가장자리를 두드릴 수 있다.
 */
'use strict';

const MIN_RUNS = 5;                 // 이력 5회 미만은 판단 안 함 (신규 크론 오경보 방지)
const GRACE_FLOOR_SEC = 1800;       // 유예 바닥 30분 — 2분 크론이 1분 늦었다고 울리지 않게
const GRACE_CEIL_SEC = 21600;       // 유예 천장 6시간 — 주 크론이 3.5일 늦도록 기다리지 않게
/* 부정기 크론 — 주기 자체가 없어서 med 가 무의미하다. trend-scout 는 월·목 21:00
   이라 간격이 3일/4일로 갈려 med 로는 언제나 '지연' 아니면 '정상' 둘 중 하나로 틀린다.
   실측 오경보 2건 중 하나가 이것. 환경변수 CRON_LATE_EXCLUDE(쉼표 구분)로 덧붙인다. */
const DEFAULT_EXCLUDE = ['trend-scout'];

function median(nums) {
  const a = (nums || []).filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  // percentile_disc(0.5) 와 같게 — 짝수 개면 아래쪽 값을 고른다 (평균 내지 않는다)
  return a[Math.floor((a.length - 1) / 2)];
}

/** 임계(초). med 가 없으면 null. */
function lateThresholdSec(medSec) {
  if (!Number.isFinite(medSec) || medSec <= 0) return null;
  const grace = Math.min(Math.max(medSec * 0.5, GRACE_FLOOR_SEC), GRACE_CEIL_SEC);
  return medSec + grace;
}

/**
 * ranAts: 한 크론의 실행 시각 목록(순서 무관, ISO 또는 ms). 최신 → 과거로 정렬해 간격의 중앙값을 낸다.
 * 반환 { n, medSec, lastRunMs } — n 은 실행 횟수(간격 수 + 1).
 */
function summarizeHistory(ranAts) {
  const ts = (ranAts || []).map((x) => (typeof x === 'number' ? x : Date.parse(x)))
    .filter((x) => Number.isFinite(x)).sort((a, b) => b - a);
  if (!ts.length) return { n: 0, medSec: null, lastRunMs: null };
  const gaps = [];
  for (let i = 0; i + 1 < ts.length; i++) gaps.push((ts[i] - ts[i + 1]) / 1000);
  return { n: ts.length, medSec: median(gaps), lastRunMs: ts[0] };
}

/**
 * histories: { [cron_name]: ranAts[] }
 * opts: { now (ms), minRuns, exclude (string[]) }
 * 반환 { checked, late: [{cron, medMin, lastRun, lateMin, thresholdMin}], skipped: {fewRuns[], excluded[]} }
 */
function judgeLateCrons(histories, opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const minRuns = Number(o.minRuns) || MIN_RUNS;
  const exclude = new Set([].concat(DEFAULT_EXCLUDE, o.exclude || []).map(String));
  const late = [], fewRuns = [], excluded = [];
  let checked = 0;

  for (const [cron, ranAts] of Object.entries(histories || {})) {
    if (!cron) continue;
    if (exclude.has(cron)) { excluded.push(cron); continue; }
    const s = summarizeHistory(ranAts);
    if (s.n < minRuns || s.medSec == null) { fewRuns.push(cron); continue; }
    checked++;
    const thr = lateThresholdSec(s.medSec);
    const sinceSec = (now - s.lastRunMs) / 1000;
    if (sinceSec > thr) {
      late.push({
        cron,
        medMin: Math.round(s.medSec / 60),
        thresholdMin: Math.round(thr / 60),
        lastRun: new Date(s.lastRunMs).toISOString(),
        lateMin: Math.round(sinceSec / 60),
      });
    }
  }
  late.sort((a, b) => b.lateMin - a.lateMin);
  return { checked, late, skipped: { fewRuns, excluded } };
}

/**
 * 재알림 간격 — 크론의 평소 주기에 비례한다 (2026-09-23 신설).
 *
 * 왜 — 24시간 고정이면 **주 크론이 한 번 빠졌을 때 닷새 내리 같은 알림이 온다.**
 * 실측(9/16~9/20): weekly-briefing 이 9/13 회차를 통째로 빠뜨렸고 지연 탐지가
 * 232회 연속 잡았다. 고정 24h 면 알림 5건 — 같은 사실을 다섯 번 말한다.
 * 주기가 일주일인 크론은 일주일에 한 번 말하면 된다.
 * 바닥은 기본 쿨다운(24h), 천장은 7일 — 한 주 넘게 입 다무는 일은 없게.
 */
const REALERT_CEIL_MS = 7 * 24 * 3600000;

function realertCooldownMs(item, baseMs) {
  const base = Number.isFinite(baseMs) ? baseMs : 24 * 3600000;
  const medMs = Number(item && item.medMin) * 60000;
  if (!Number.isFinite(medMs) || medMs <= 0) return base;
  return Math.min(Math.max(medMs, base), REALERT_CEIL_MS);
}

/**
 * 중복 억제 — 같은 크론이 늦은 채로 있으면 30분마다 같은 알림이 오면 안 된다.
 * state: ops_alert_state.last_payload 로 저장되는 { late: { [cron]: lastAlertIso } }
 * 반환 { toAlert: [...late 항목], recovered: [cron...], nextState }
 *   · 처음 늦었거나(상태에 없음) 마지막 알림이 재알림 간격보다 오래됐으면 알린다
 *   · 재알림 간격은 크론마다 다르다 (realertCooldownMs — 평소 주기에 비례)
 *   · 늦지 않게 된 크론은 상태에서 빠지고 recovered 에 실린다
 */
function decideLateAlerts(judged, state, opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const baseCooldownMs = Number.isFinite(o.cooldownMs) ? o.cooldownMs : 24 * 3600000;
  const prev = (state && state.late && typeof state.late === 'object') ? state.late : {};
  const nextLate = {};
  const toAlert = [];
  for (const x of (judged && judged.late) || []) {
    const lastIso = prev[x.cron];
    const lastMs = lastIso ? Date.parse(lastIso) : 0;
    if (!lastMs || now - lastMs > realertCooldownMs(x, baseCooldownMs)) {
      toAlert.push(x);
      nextLate[x.cron] = new Date(now).toISOString();
    } else {
      nextLate[x.cron] = lastIso;
    }
  }
  const recovered = Object.keys(prev).filter((c) => !(c in nextLate));
  return { toAlert, recovered, nextState: { late: nextLate } };
}

function fmtLate(x) {
  const late = x.lateMin >= 1440 ? (x.lateMin / 1440).toFixed(1) + '일' : x.lateMin + '분';
  const med = x.medMin >= 1440 ? (x.medMin / 1440).toFixed(1) + '일' : x.medMin + '분';
  return x.cron + ' — 마지막 실행 ' + late + ' 전 (평소 주기 ' + med + ', 임계 '
    + (x.thresholdMin >= 1440 ? (x.thresholdMin / 1440).toFixed(1) + '일' : x.thresholdMin + '분') + ')';
}

function buildLateAlert(items, site) {
  const first = items[0] || {};
  return {
    title: '🚨 크론이 제때 안 돌았다 — ' + (first.cron || '') + (items.length > 1 ? ' 외 ' + (items.length - 1) + '건' : ''),
    lines: items.slice(0, 6).map(fmtLate).concat([
      '',
      '에러가 아니다 — 실행 기록 자체가 없다. 그래서 실패 감시엔 안 걸린다.',
      '2026-09-13~14 에 이 모양으로 7건이 빠졌고 하루치 일이 영영 안 됐다.',
      '',
      '볼 곳: Vercel → Cron Jobs 탭 (스케줄러가 호출했는지) · /admin/crons',
    ]),
    url: (site || '') + '/admin/crons',
    urlLabel: '크론 상태',
  };
}

/** vercel.json 의 crons 경로 → cron_name 후보 (basename, 쿼리 제거). 이력 학습의 씨앗일 뿐이다. */
function cronNamesFromVercel(json) {
  const out = new Set();
  for (const c of (json && json.crons) || []) {
    const p = String((c && c.path) || '').split('?')[0];
    const base = p.split('/').filter(Boolean).pop();
    if (base) out.add(base);
  }
  return Array.from(out);
}

module.exports = {
  MIN_RUNS, GRACE_FLOOR_SEC, GRACE_CEIL_SEC, DEFAULT_EXCLUDE,
  REALERT_CEIL_MS, realertCooldownMs,
  median, lateThresholdSec, summarizeHistory, judgeLateCrons, decideLateAlerts,
  buildLateAlert, fmtLate, cronNamesFromVercel,
};
