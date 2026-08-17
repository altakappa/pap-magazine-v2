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

/* 고정 채널 = 우리가 의도적으로 운영하는 곳. 순서 = 성적표 표시 순서:
   진성 한국인 전선 먼저. 0건이어도 줄을 남긴다 — "안 하고 있다"도 정보다. */
const CHANNELS = ['naver', 'kakao', 'ig', 'threads', 'x', 'tiktok', 'youtube', 'newsletter', 'chatgpt'];

/* 고정 목록 밖의 출처를 몇 개까지 이름으로 보여줄지 (2026-08-10).
   예전엔 목록에 없으면 전부 'other' 로 뭉갰다. socialInclick.js 가 원본을
   보존하게 됐는데 여기서 다시 뭉개면 고친 의미가 없다. 다만 무한정 늘리면
   표가 못 읽게 되므로 상위 N개만 이름으로 내고 나머지는 'other' 로 접는다. */
const MAX_DISCOVERED = 5;

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
  // 실제로 들어온 값 그대로 집계한다 (고정 목록으로 미리 자르지 않는다).
  const agg = {};
  CHANNELS.forEach((c) => { agg[c] = { cur: 0, prev: 0 }; });
  (inRows || []).forEach((r) => {
    const ch = String(r.src || 'other');
    if (!agg[ch]) agg[ch] = { cur: 0, prev: 0 };
    if (r.clicked_at >= d7) agg[ch].cur++; else agg[ch].prev++;
  });

  // 2026-08-16 — 원본이 아니라 인간필터 뷰(087+125)를 센다. 8/1~8/9 봇
  // 함대(데스크탑 UA 10종 × IP 1,100여 개)가 원본 수치를 최대 30배
  // 부풀렸고, 함대가 떠나자 주간 비교가 -65% "급락"으로 오독됐다.
  // 모바일 클릭 수도 같이 세서 봇 의심 경보(아래)에 쓴다.
  const [igOutCur, igOutPrev, igOutMobileCur, memCur, memPrev, paidTotal] = await Promise.all([
    _count('ig_outclicks_human', 'clicked_at', d7, null),
    _count('ig_outclicks_human', 'clicked_at', d14, d7),
    _count('ig_outclicks_human', 'clicked_at', d7, null, (q) => q.eq('device_type', 'mobile')),
    _count('profiles', 'created_at', d7, null),
    _count('profiles', 'created_at', d14, d7),
    _count('profiles', 'created_at', '1970-01-01', null,
      (q) => q.in('subscription_plan', ['standard', 'premium'])),
  ]);

  /* 표시 순서: 고정 채널 → 새로 발견된 출처(최근 7일 많은 순, 최대 5개) → other.
     'other' 는 이제 "분류 실패"가 아니라 "꼬리를 접은 것"이다. */
  const discovered = Object.keys(agg)
    .filter((k) => !CHANNELS.includes(k) && k !== 'other')
    .sort((a, b) => (agg[b].cur - agg[a].cur) || (agg[b].prev - agg[a].prev) || a.localeCompare(b));
  const shown = discovered.slice(0, MAX_DISCOVERED);
  const folded = discovered.slice(MAX_DISCOVERED);

  const other = { cur: (agg.other || { cur: 0 }).cur, prev: (agg.other || { prev: 0 }).prev };
  folded.forEach((k) => { other.cur += agg[k].cur; other.prev += agg[k].prev; });

  const order = CHANNELS.concat(shown);
  const inflow = order.map((ch) => ({ ch, cur: agg[ch].cur, prev: agg[ch].prev }));
  if (other.cur || other.prev) inflow.push({ ch: 'other', cur: other.cur, prev: other.prev });

  return {
    inflow,
    discoveredCount: discovered.length,
    foldedIntoOther: folded,
    // 봇 의심 경보 — 진짜 사람 트래픽은 모바일이 다수(7/27 실측 91%)다.
    // 표본이 충분한데(주 50건+) 모바일이 10% 미만이면 필터를 뚫은 새
    // 봇 함대일 가능성이 높다. 숫자는 그대로 두고 표에 경고만 단다.
    igOut: {
      cur: igOutCur, prev: igOutPrev,
      mobilePct: igOutCur ? Math.round((100 * igOutMobileCur) / igOutCur) : null,
      botSuspect: igOutCur >= 50 && (igOutMobileCur / igOutCur) < 0.10,
    },
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
  const igOutWarn = sc.igOut.botSuspect
    ? ' ⚠️ 봇 의심(모바일 ' + sc.igOut.mobilePct + '%)'
    : '';
  lines.push('| 웹 → 인스타그램 (ig-out)' + igOutWarn + ' | ' + sc.igOut.cur + ' | ' + _delta(sc.igOut.cur, sc.igOut.prev) + ' |');
  lines.push('| 신규 회원 가입 | ' + sc.newMembers.cur + ' | ' + _delta(sc.newMembers.cur, sc.newMembers.prev) + ' |');
  lines.push('| 유료 구독자 (누적) | ' + sc.paidTotal + ' | 북극성 ② |');
  lines.push('');
  lines.push('_북극성 ①(IG 팔로우·프로필 방문의 한국 비중)은 IG 인사이트에서 수동 확인 — API 미제공._');
  return lines.join('\n');
}

module.exports = { buildChannelScorecard, renderScorecardMd, CHANNELS };
