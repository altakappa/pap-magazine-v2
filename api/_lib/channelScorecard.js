/**
 * 주간 채널 성적표 — api/_lib/channelScorecard.js (2026-08-08 신설)
 *
 * 왜 ────────────────────────────────────────────────────────────────
 * 성장 가이드라인(볼트 45_Business/PAP-성장-가이드라인.md) 6번:
 * "채널 성적은 채널 안 지표가 아니라 **두 도달점(IG·웹)으로 몇 명을
 * 보냈나** 로만 잰다." 데이터는 이미 다 쌓이는데(social_inclicks·
 * ig_outclicks·profiles) 매주 사람이 꺼내 봐야 했다 — 그래서 아무도
 * 안 봤다. 주간 브리핑(weekly-briefing)에 자동 표로 싣는다.
 *
 * 왜 새 크론이 아니라 lib 인가: 가이드라인 7번 "새 채널(리포트) 개설
 * 금지" — 주간 브리핑이라는 기존 도달 채널에 통합한다. 이 lib 는
 * 숫자만 만들고, 어디 실을지는 소비자가 정한다.
 *
 * 숫자는 결정론(집계 그대로) — AI 가 만지지 않는다. AI 서사가 실패해도
 * 성적표는 나간다.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

/* 유입 채널 (socialInclick.js SRC_WHITELIST 와 동일 + other).
   순서 = 성적표 표시 순서: 진성 한국인 전선 먼저. */
const CHANNELS = ['naver', 'kakao', 'ig', 'threads', 'x', 'tiktok', 'youtube', 'newsletter', 'other'];

async function _count(table, tsCol, gteIso, ltIso, extra) {
  let q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true })
    .gte(tsCol, gteIso);
  if (ltIso) q = q.lt(tsCol, ltIso);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

/**
 * 지난 7일 vs 그 전 7일.
 * @returns {{
 *   inflow: Array<{ch, cur, prev}>,   // 외부→웹 유입 (utm 계측)
 *   igOut: {cur, prev},               // 웹→IG (플라이휠 절반)
 *   newMembers: {cur, prev},          // 사다리: 회원 가입
 *   paidTotal: number,                // 북극성 ②: 유료 구독자 (누적)
 * }}
 */
async function buildChannelScorecard(now) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const d7 = new Date(nowMs - 7 * 86400000).toISOString();
  const d14 = new Date(nowMs - 14 * 86400000).toISOString();

  // 유입: 주간 수백 건 규모(실측 120/기간)라 행을 받아 JS 로 집계한다.
  // (PostgREST 는 group by 가 없고, rpc 를 새로 파는 것보다 이게 단순하다.
  //  폭증 대비 상한 20,000 — 넘치면 그건 행복한 비상사태고 rpc 로 옮긴다.)
  const { data: inRows, error: inErr } = await supabaseAdmin
    .from('social_inclicks').select('src, clicked_at')
    .gte('clicked_at', d14).limit(20000);
  if (inErr) throw inErr;
  const agg = {};
  CHANNELS.forEach((c) => { agg[c] = { cur: 0, prev: 0 }; });
  (inRows || []).forEach((r) => {
    const ch = agg[r.src] ? r.src : 'other';
    if (r.clicked_at >= d7) agg[ch].cur++; else agg[ch].prev++;
  });

  const [igOutCur, igOutPrev, memCur, memPrev, paidTotal] = await Promise.all([
    _count('ig_outclicks', 'clicked_at', d7, null),
    _count('ig_outclicks', 'clicked_at', d14, d7),
    _count('profiles', 'created_at', d7, null),
    _count('profiles', 'created_at', d14, d7),
    _count('profiles', 'created_at', '1970-01-01', null,
      (q) => q.in('subscription_plan', ['standard', 'premium'])),
  ]);

  return {
    inflow: CHANNELS.map((ch) => ({ ch, cur: agg[ch].cur, prev: agg[ch].prev })),
    igOut: { cur: igOutCur, prev: igOutPrev },
    newMembers: { cur: memCur, prev: memPrev },
    paidTotal,
  };
}

/* 전주 대비 표기. 0→0 은 '—', 0→n 은 'NEW'. */
function _delta(cur, prev) {
  if (!prev && !cur) return '—';
  if (!prev) return 'NEW';
  const pct = Math.round(((cur - prev) / prev) * 100);
  return (pct >= 0 ? '+' : '') + pct + '%';
}

const CH_LABEL = {
  naver: '네이버', kakao: '카카오톡', ig: '인스타그램', threads: '스레드',
  x: 'X', tiktok: '틱톡', youtube: '유튜브', newsletter: '뉴스레터', other: '기타',
};

/** 브리핑에 그대로 붙는 결정론 마크다운 (AI 산출물 아님). */
function renderScorecardMd(sc) {
  const lines = [
    '## 채널 성적표 (자동 집계 — 지난 7일 vs 그 전 7일)',
    '',
    '**외부 → 웹 유입 (utm 계측)**',
    '',
    '| 채널 | 이번 주 | 전주 대비 |',
    '|---|---|---|',
  ];
  sc.inflow.forEach((r) => {
    if (!r.cur && !r.prev) return; // 0/0 채널은 표를 어지럽히지 않는다
    lines.push('| ' + (CH_LABEL[r.ch] || r.ch) + ' | ' + r.cur + ' | ' + _delta(r.cur, r.prev) + ' |');
  });
  const inflowCur = sc.inflow.reduce((s, r) => s + r.cur, 0);
  const inflowPrev = sc.inflow.reduce((s, r) => s + r.prev, 0);
  lines.push('| **합계** | **' + inflowCur + '** | ' + _delta(inflowCur, inflowPrev) + ' |');
  lines.push('');
  lines.push('**플라이휠·사다리**');
  lines.push('');
  lines.push('| 흐름 | 이번 주 | 전주 대비 |');
  lines.push('|---|---|---|');
  lines.push('| 웹 → 인스타그램 (ig-out) | ' + sc.igOut.cur + ' | ' + _delta(sc.igOut.cur, sc.igOut.prev) + ' |');
  lines.push('| 신규 회원 가입 | ' + sc.newMembers.cur + ' | ' + _delta(sc.newMembers.cur, sc.newMembers.prev) + ' |');
  lines.push('| 유료 구독자 (누적) | ' + sc.paidTotal + ' | 북극성 ② |');
  lines.push('');
  lines.push('_북극성 ①(IG 팔로우·프로필 방문의 한국 비중)은 IG 인사이트에서 수동 확인 — API 미제공._');
  return lines.join('\n');
}

module.exports = { buildChannelScorecard, renderScorecardMd, CHANNELS };
