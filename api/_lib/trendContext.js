/**
 * 주간 브리핑 — 추세·계절 맥락 (2026-10-19 신설)
 *
 * [왜] 10/19 브리핑이 "ChatGPT 유입 40% 붕괴(671→400), 발행량 변화 없음, 검색 랭킹
 * 재조정 추정" 이라고 썼다. DB 를 보니 셋 다 틀렸다.
 *   · 주별 chatgpt 고유 방문자: 8월 말 350·380 → 9/28주 801(파리 패션위크) → 10/12주 340.
 *     340은 8월 말 수준이다. 붕괴가 아니라 성수기(9/10~10/6 4대 패션위크)가 끝난 것.
 *   · 웹 기사 주별 88 → 142(패션위크) → 81 → 74. 발행은 반토막 났다.
 *   · 기사 1건당 chatgpt 유입 4.6 — 8월 말(4.9~5.2)과 같다. 기사당 효율은 안 떨어졌다.
 *   · 챗GPT가 답하려고 우리 글을 읽은 횟수(ChatGPT-User)는 하루 170~270 → 300~415 로 늘었다.
 *     밀려났으면 이게 먼저 줄어야 한다.
 * 9/21 사고("발행이 멈췄다" 추측)의 재판이다. 브리핑이 "7일 vs 그 전 7일" 두 점만 보니
 * 성수기 끝을 붕괴로 읽는다. 이 모듈은 AI 에게 **6주 추세 + 행사 달력 + 기사당 효율 +
 * 선행지표(봇 읽기)** 를 같이 넘긴다. 결정론 집계라 AI 가 죽어도 표는 나간다.
 *
 * 집계는 행을 받아 JS 로 센다 (channelScorecard 와 같은 이유: PostgREST 에 group by 가 없다).
 * 상한 20,000 행 — 넘치면 `capped: true` 로 표시하고 그 주 숫자는 '이상' 으로 읽는다.
 */
'use strict';

const { supabaseAdmin } = require('./supabase');

const ROW_CAP = 20000;

/* 유입 피크를 만드는 행사 창. 과거 창은 실측 날짜, 미래 창은 관례 기반 예정(approx).
   브리핑이 "이번 주/전주가 성수기 안이었나" 를 알게 하는 용도라 정확도는 주 단위면 된다.
   한 해가 지나면 다음 해 창을 덧붙인다 (지우지 않는다 — 과거 비교에 쓴다). */
const EVENT_CALENDAR = [
  { name: '뉴욕 패션위크 SS27', from: '2026-09-10', to: '2026-09-16' },
  { name: '런던 패션위크 SS27', from: '2026-09-17', to: '2026-09-22' },
  { name: '밀라노 패션위크 SS27', from: '2026-09-23', to: '2026-09-29' },
  { name: '파리 패션위크 SS27', from: '2026-09-28', to: '2026-10-06' },
  { name: '밀라노 남성복 FW27 (예정)', from: '2027-01-15', to: '2027-01-20', approx: true },
  { name: '파리 남성복 FW27 (예정)', from: '2027-01-19', to: '2027-01-25', approx: true },
  { name: '파리 오트 쿠튀르 SS27 (예정)', from: '2027-01-25', to: '2027-01-29', approx: true },
  { name: '뉴욕 패션위크 FW27 (예정)', from: '2027-02-11', to: '2027-02-17', approx: true },
  { name: '런던 패션위크 FW27 (예정)', from: '2027-02-18', to: '2027-02-23', approx: true },
  { name: '밀라노 패션위크 FW27 (예정)', from: '2027-02-24', to: '2027-03-02', approx: true },
  { name: '파리 패션위크 FW27 (예정)', from: '2027-03-01', to: '2027-03-10', approx: true },
];

function overlaps(aFrom, aTo, bFrom, bTo) { return aFrom <= bTo && bFrom <= aTo; }

/** [from, to] (YYYY-MM-DD, 양끝 포함) 과 겹치는 행사 이름 목록. */
function eventsInWindow(from, to, calendar) {
  return (calendar || EVENT_CALENDAR)
    .filter((e) => overlaps(from, to, e.from, e.to))
    .map((e) => e.name);
}

/** KST 기준 YYYY-MM-DD → 그 주 월요일 YYYY-MM-DD. */
function weekStartOf(dayStr) {
  const d = new Date(dayStr + 'T00:00:00Z');
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}
function addDays(dayStr, n) {
  return new Date(new Date(dayStr + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
}
function kstDay(ms) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }

/**
 * 순수 집계 (테스트용으로 분리). 입력은 행 배열, 출력은 주별 표.
 *   clicks:   [{clicked_at(ISO), ip_hash}]       — chatgpt 유입(인간필터 뷰)
 *   articles: [{published_date(YYYY-MM-DD)}]     — 발행 기사
 *   fetches:  [{day(YYYY-MM-DD), hits}]          — ChatGPT-User 가 글을 읽은 횟수
 */
function aggregateWeekly({ clicks, articles, fetches, nowMs, weeks, calendar }) {
  const today = kstDay(nowMs);
  const thisMon = weekStartOf(today);
  const rows = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(thisMon, -7 * i);
    rows.push({ week: ws, end: addDays(ws, 6), chatgpt_visitors: 0, articles: 0, chatgpt_user_fetches: 0, _ips: new Set() });
  }
  const byWeek = {};
  rows.forEach((r) => { byWeek[r.week] = r; });
  (clicks || []).forEach((c) => {
    const w = byWeek[weekStartOf(kstDay(new Date(c.clicked_at).getTime()))];
    if (w) w._ips.add(c.ip_hash || ('row' + Math.random()));
  });
  (articles || []).forEach((a) => {
    const w = a.published_date && byWeek[weekStartOf(String(a.published_date).slice(0, 10))];
    if (w) w.articles++;
  });
  (fetches || []).forEach((f) => {
    const w = f.day && byWeek[weekStartOf(String(f.day).slice(0, 10))];
    if (w) w.chatgpt_user_fetches += Number(f.hits) || 0;
  });
  rows.forEach((r) => {
    r.chatgpt_visitors = r._ips.size; delete r._ips;
    r.per_article = r.articles ? Math.round(r.chatgpt_visitors / r.articles * 10) / 10 : null;
    r.events = eventsInWindow(r.week, r.end, calendar);
    r.partial = r.end >= today; // 이번 주는 아직 안 끝났다 — 전주와 직접 비교 금지
  });
  /* 기준선 = 행사 창 밖 + 완결된 주 들의 중앙값. 성수기 피크를 기준으로 삼으면
     그 다음 주는 언제나 "붕괴" 가 된다. */
  const base = rows.filter((r) => !r.partial && !r.events.length && r.chatgpt_visitors > 0) // 0 은 보통 '기록 없음'
    .map((r) => r.chatgpt_visitors).sort((a, b) => a - b);
  const baseline = base.length ? base[Math.floor(base.length / 2)] : null;
  const upcoming = (calendar || EVENT_CALENDAR).filter((e) => e.from > today && e.from <= addDays(today, 60))
    .map((e) => e.name + ' ' + e.from + '~' + e.to);
  return { rows, baseline, upcoming };
}

/* 기본 10주: 패션 성수기(9월 둘째 주~10월 첫 주, 4주)를 통째로 품고도 그 앞뒤 비수기 주가 남아야
   기준선이 한 주짜리가 되지 않는다. 7주면 10월 셋째 주 시점에 비수기 완결 주가 하나뿐이다. */
async function buildTrendContext({ weeks = 10, nowMs = Date.now() } = {}) {
  const since = addDays(weekStartOf(kstDay(nowMs)), -7 * (weeks - 1));
  const sinceIso = since + 'T00:00:00+09:00';
  const [c, a, f] = await Promise.all([
    supabaseAdmin.from('social_inclicks_human').select('clicked_at, ip_hash')
      .eq('src', 'chatgpt').gte('clicked_at', sinceIso).limit(ROW_CAP),
    supabaseAdmin.from('articles').select('published_date')
      .eq('status', 'published').gte('published_date', since).limit(ROW_CAP),
    supabaseAdmin.from('ai_crawl_daily').select('day, hits')
      .eq('platform', 'chatgpt').eq('kind', 'live').gte('day', since).limit(ROW_CAP),
  ]);
  const err = c.error || a.error || f.error;
  if (err) throw err;
  const out = aggregateWeekly({ clicks: c.data || [], articles: a.data || [], fetches: f.data || [], nowMs, weeks });
  out.capped = [c, a, f].some((r) => (r.data || []).length >= ROW_CAP);
  return out;
}

/** 브리핑에 그대로 붙는 마크다운. AI 산출물 아님. */
function renderTrendMd(ctx) {
  if (!ctx || !ctx.rows || !ctx.rows.length) return '';
  const L = [];
  L.push('\n## 추세·계절 맥락 (' + ctx.rows.length + '주 — 7일 두 점만 보면 성수기 끝을 붕괴로 읽는다)');
  L.push('');
  L.push('| 주(월요일) | ChatGPT 유입(명) | 웹 기사(건) | 기사당 유입 | 챗GPT가 글 읽은 횟수 | 행사 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of ctx.rows) {
    L.push('| ' + r.week + (r.partial ? ' (진행 중)' : '') + ' | ' + r.chatgpt_visitors + ' | ' + r.articles
      + ' | ' + (r.per_article == null ? '—' : r.per_article) + ' | ' + r.chatgpt_user_fetches
      + ' | ' + (r.events.length ? r.events.join(', ') : '') + ' |');
  }
  L.push('');
  L.push('> 기준선(행사 없는 완결 주의 중앙값): **' + (ctx.baseline == null ? '산출 불가' : ctx.baseline + '명/주') + '**.'
    + ' 성수기 다음 주의 하락은 기준선과 비교해 판단한다. 기사당 유입이 그대로면 효율 문제가 아니라 양 문제다.'
    + ' "챗GPT가 글 읽은 횟수" 는 선행지표다 — 이게 안 줄었으면 랭킹에서 밀린 게 아니다.');
  if (ctx.upcoming && ctx.upcoming.length) L.push('> 60일 안 행사: ' + ctx.upcoming.join(' · '));
  if (ctx.capped) L.push('> ⚠️ 행 상한(' + ROW_CAP + ') 도달 — 일부 주 숫자는 실제보다 작을 수 있다.');
  L.push('');
  return L.join('\n');
}

module.exports = { buildTrendContext, aggregateWeekly, renderTrendMd, eventsInWindow, weekStartOf, EVENT_CALENDAR, ROW_CAP };
