/**
 * 크론 실행시간 감시 — '잘려 죽은 실행' 을 찾아낸다. (2026-08-04 신설)
 *
 * 왜 만들었나 ────────────────────────────────────────────────────────
 * backfill-translations 가 6시간 동안 22번 Vercel 의 120초 상한에 걸려
 * 강제종료됐는데, cron_runs 의 실패는 **0건**이었다. 당연하다 — 함수가
 * 도중에 죽으면 "나 죽었다" 를 기록할 주체가 없다. 남는 건 ok=true 로
 * 끝난 짧은 실행들뿐이고, 지표는 평화로워 보인다.
 *
 * 이 프로젝트가 반복해서 배운 것: **'돌았다' 는 '해냈다' 가 아니다.**
 * FAQ 백필은 0건을 만들면서 성실히 돌았고, 릴스 기사는 반쪽인 채로
 * 발행됐고, 이번엔 함수가 일하다 잘려나갔다. 셋 다 ok=true 였다.
 *
 * 그래서 이 감시는 성공/실패가 아니라 **시간**을 본다. 실행시간이 함수
 * 상한에 붙기 시작하면, 아직 아무것도 실패하지 않았어도 경보를 울린다.
 * 상한에 붙은 크론은 이미 매 실행마다 뒷부분을 잃고 있기 때문이다.
 *
 * 판정은 순수 함수다 — DB 도 네트워크도 모른다(테스트 용이성).
 */

/* vercel.json 의 functions.maxDuration (초) 과 같아야 한다. */
const FN_LIMIT_MS = 120000;

/* 이 선을 넘은 실행은 '상한에 붙었다' 로 센다. 상한의 85% —
   여기까지 왔으면 다음 실행은 조금만 느려져도 잘린다. */
const NEAR_RATIO = 0.85;

/* 표본이 이보다 적으면 판단하지 않는다. 한두 번 느린 건 늘 있다. */
const MIN_RUNS_TO_JUDGE = 8;

/* 이 비율 이상이 상한에 붙어 있으면 우연이 아니라 구조다. */
const OVER_RATE_ALERT = 0.25;

/**
 * cron_runs 행들을 크론별로 요약한다.
 * @param {Array<{cron_name:string, duration_ms:number}>} rows
 * @param {number} [nearMs] 상한에 붙었다고 볼 기준 ms
 * @returns {Array<{name,runs,over,maxMs,avgMs,overRate}>} 위험한 순
 */
function summarizeDurations(rows, nearMs) {
  const bar = Number(nearMs) > 0 ? Number(nearMs) : Math.round(FN_LIMIT_MS * NEAR_RATIO);
  const by = new Map();
  for (const r of (rows || [])) {
    const name = r && r.cron_name;
    if (!name) continue;
    /* duration_ms 가 비어 있는 행은 '0초에 끝났다' 가 아니라 '모른다' 다.
       0으로 세면 상한 근접 비율이 희석돼 정작 위험한 크론이 묻힌다. */
    if (r.duration_ms === null || r.duration_ms === undefined || r.duration_ms === '') continue;
    const ms = Number(r.duration_ms);
    if (!Number.isFinite(ms) || ms < 0) continue;
    let e = by.get(name);
    if (!e) { e = { name, runs: 0, over: 0, maxMs: 0, sum: 0 }; by.set(name, e); }
    e.runs++;
    e.sum += ms;
    if (ms > e.maxMs) e.maxMs = ms;
    if (ms >= bar) e.over++;
  }
  const out = [];
  for (const e of by.values()) {
    out.push({
      name: e.name, runs: e.runs, over: e.over, maxMs: e.maxMs,
      avgMs: Math.round(e.sum / e.runs),
      overRate: e.runs ? e.over / e.runs : 0,
    });
  }
  /* 위험한 순 — 비율이 같으면 표본이 큰 쪽을 앞에 둔다. */
  out.sort((a, b) => (b.overRate - a.overRate) || (b.runs - a.runs));
  return out;
}

/**
 * 판정 — 상한에 붙어 있는 크론이 있는가.
 * @param {Array} summary summarizeDurations 결과
 * @param {object} [opts] {windowHours, limitMs}
 */
function judgeCronDuration(summary, opts) {
  const o = opts || {};
  const limitMs = Number(o.limitMs) > 0 ? Number(o.limitMs) : FN_LIMIT_MS;
  const list = (summary || []).filter(s => s && s.runs >= MIN_RUNS_TO_JUDGE);
  const base = {
    limitMs,
    nearMs: Math.round(limitMs * NEAR_RATIO),
    windowHours: Number(o.windowHours) || 0,
    judged: list.length,
    offenders: [],
  };

  if (!list.length) {
    return { ...base, status: 'unknown', healthy: true,
      reason: '표본이 ' + MIN_RUNS_TO_JUDGE + '회에 못 미쳐 판단하지 않는다.' };
  }

  const offenders = list.filter(s => s.overRate >= OVER_RATE_ALERT);
  if (offenders.length) {
    const w = offenders[0];
    return {
      ...base, offenders, status: 'over-budget', healthy: false,
      worst: w.name,
      reason: w.name + ' — ' + w.runs + '회 중 ' + w.over + '회(' + Math.round(w.overRate * 100)
        + '%)가 함수 상한 ' + Math.round(limitMs / 1000) + '초에 붙었다. 최대 '
        + Math.round(w.maxMs / 1000) + '초 · 평균 ' + Math.round(w.avgMs / 1000) + '초.',
    };
  }

  /* 아직 비율은 낮지만 상한을 실제로 넘긴 적이 있다 — 관찰만 한다. */
  const touched = list.filter(s => s.maxMs >= limitMs);
  if (touched.length) {
    return {
      ...base, offenders: touched, status: 'near-limit', healthy: true,
      worst: touched[0].name,
      reason: touched[0].name + ' 이(가) 상한을 한 번 넘겼다(최대 '
        + Math.round(touched[0].maxMs / 1000) + '초). 비율은 아직 낮다.',
    };
  }

  return { ...base, status: 'ok', healthy: true, reason: '모든 크론이 예산 안에서 끝난다.' };
}

/**
 * 경보 문안 — pushAlert 가 그대로 쓰는 모양({title, lines, url, urlLabel}).
 * 무엇을 봐야 하는지까지 적는다. 숫자만 던지면 다음 사람이 또 헤맨다.
 */
function buildCronDurationAlert(d, site) {
  const S = site || 'https://www.pap-magazine.com';
  const lines = [d.reason, ''];
  if (d.offenders && d.offenders.length > 1) {
    lines.push('같은 증상: ' + d.offenders.slice(1, 4)
      .map(s => s.name + ' ' + Math.round(s.overRate * 100) + '%').join(', '), '');
  }
  lines.push(
    '상한에 걸려 강제종료된 실행은 cron_runs 에 실패로 남지 않습니다 —',
    '기록을 남길 주체가 함께 죽기 때문입니다. 성공률만 보면 정상으로 보입니다.',
    '',
    '볼 곳: 그 크론이 한 번 실행에서 외부 호출을 몇 번 하는지, 그리고',
    '그 호출들이 남은 시간(마감시각)을 확인하고 있는지.',
    "  select cron_name, avg(duration_ms)::int, max(duration_ms) from cron_runs",
    "  where ran_at > now() - interval '3 hours' group by 1 order by 2 desc;");
  return {
    title: '⏱ 크론이 함수 상한에 붙었습니다',
    lines,
    url: `${S}/admin`,
    urlLabel: '어드민',
  };
}

module.exports = {
  summarizeDurations, judgeCronDuration, buildCronDurationAlert,
  FN_LIMIT_MS, NEAR_RATIO, MIN_RUNS_TO_JUDGE, OVER_RATE_ALERT,
};
