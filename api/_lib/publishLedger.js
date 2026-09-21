/**
 * PAP Magazine — 발행 장부 (2026-09-21 신설)
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────────
 * 9/21 주간 브리핑이 threads 유입 -91% 를 두고 이렇게 썼다:
 *
 *   "유력 가설 ① 이벤트 로그 공백 = 미기록 요인 가능성 100%"
 *   "② threads/X 알고리즘 변화 또는 posting 중단"
 *   "다음 주의 베팅: threads 1일 1회, X 1일 2회 발행 재개"
 *
 * **멈춘 적이 없었다.** 실측:
 *   threads  이번주 49건 · 전주 49건   (동일)
 *   X        이번주 171건 · 전주 179건 (-4%)
 *
 * 브리핑은 한 주의 베팅 전부를 "재개할 것이 없는 재개"에 걸었다.
 *
 * ── 왜 그런 가설이 나왔나 ──────────────────────────────────────────
 * 브리핑이 AI 에게 넘기는 입력에 **발행 실적이 없었다.** 유입·팔로워·
 * 도달은 다 넘기면서, 그 숫자를 만든 쪽인 "우리가 얼마나 내보냈나" 는
 * 안 넘겼다. 그러니 AI 는 남은 칸(growth_events)이 비어 있는 것을 보고
 * "기록이 없으니 발행이 멈췄을 수도" 라고 추측할 수밖에 없었다.
 *
 * 사람이 로그를 매일 적게 만드는 것보다, **DB 가 이미 아는 것을 넘기는 것**이
 * 먼저다. 발행량은 growth_events 에 적히지 않아도 테이블에 그대로 있다.
 *
 * ── 무엇을 세나 ────────────────────────────────────────────────────
 * 채널별로 "이번 7일 vs 그 전 7일" 게시 건수. 네 곳 전부 **발행 시각이
 * 명확한 테이블**만 쓴다. 추정하지 않는다.
 *   articles(status=published) · threads_posts · x_posts · ig_post_latest
 *
 * 실패해도 null 을 돌려주지 않는다 — 채널별로 error 를 남긴다.
 * "0건" 과 "못 셌다" 가 같은 얼굴이면 이번 사고가 그대로 반복된다.
 */
'use strict';

const { supabaseAdmin } = require('./supabase');

const WEEK_MS = 7 * 86400000;

/** 한 테이블의 두 주간 건수. 실패는 숨기지 않고 error 로 돌려준다. */
async function countTwoWeeks(label, table, timeCol, applyFilter) {
  const now = Date.now();
  const t0 = new Date(now - 2 * WEEK_MS).toISOString();
  const t1 = new Date(now - WEEK_MS).toISOString();
  const t2 = new Date(now).toISOString();

  const one = async (from, to) => {
    let q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true })
      .gte(timeCol, from).lt(timeCol, to);
    if (applyFilter) q = applyFilter(q);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count || 0;
  };

  try {
    const [prev, cur] = await Promise.all([one(t0, t1), one(t1, t2)]);
    /* 변화율은 전주가 0 이면 만들지 않는다. 0 → 5 를 "+500%" 로 적으면
       읽는 사람이 규모를 착각한다. null 이면 표에서 '—' 로 나간다. */
    const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    return { channel: label, this_week: cur, last_week: prev, pct, error: null };
  } catch (e) {
    /* 못 센 것을 0 으로 돌려주면 "발행이 멈췄다" 는 거짓 서사가 또 나온다.
       숫자를 null 로 두고 사유를 남긴다 — AI 프롬프트가 이걸 읽고
       '모른다' 와 '0' 을 구분한다. */
    return {
      channel: label, this_week: null, last_week: null, pct: null,
      error: String((e && e.message) || e).slice(0, 120),
    };
  }
}

/**
 * 채널별 발행 실적 (7일 vs 그 전 7일).
 * @returns {Promise<{rows: Array, measured_at: string}>}
 */
async function buildPublishLedger() {
  const rows = await Promise.all([
    countTwoWeeks('웹 기사', 'articles', 'published_date',
      (q) => q.eq('status', 'published')),
    countTwoWeeks('스레드', 'threads_posts', 'created_at', null),
    countTwoWeeks('X', 'x_posts', 'created_at', null),
    /* ig_post_latest 의 게시 시각 칸은 posted_at 이다. timestamp 가 아니다 —
       내가 처음에 틀렸고, 실제 조회가 'column does not exist' 로 잡아냈다.
       이 파일이 error 를 0 으로 뭉개지 않는 이유가 바로 이것이다. */
    countTwoWeeks('인스타그램', 'ig_post_latest', 'posted_at', null),
  ]);
  return { rows, measured_at: new Date().toISOString() };
}

/** 브리핑 본문에 붙는 표. 결정론 — AI 가 숫자를 다시 쓰지 않는다. */
function renderPublishLedgerMd(ledger) {
  const rows = (ledger && ledger.rows) || [];
  if (!rows.length) return '';
  const body = rows.map((r) => {
    const cur = r.error ? '측정 실패' : String(r.this_week);
    const prev = r.error ? '—' : String(r.last_week);
    const delta = r.error ? ('⚠️ ' + r.error)
      : (r.pct == null ? '—' : (r.pct > 0 ? '+' : '') + r.pct + '%');
    return '| ' + r.channel + ' | ' + cur + ' | ' + prev + ' | ' + delta + ' |';
  }).join('\n');
  return [
    '### 발행 장부 (우리가 내보낸 양 — 지난 7일 vs 그 전 7일)',
    '',
    '> 유입이 떨어졌을 때 **먼저 볼 것**. 발행이 줄어서 떨어진 것과,',
    '> 같은 양을 내보냈는데 떨어진 것은 완전히 다른 문제다.',
    '> 전주가 0 이면 변화율을 적지 않는다(— 표시).',
    '',
    '| 채널 | 이번 주 | 전주 | 변화 |',
    '|---|---|---|---|',
    body,
  ].join('\n');
}

module.exports = { buildPublishLedger, renderPublishLedgerMd, countTwoWeeks };
