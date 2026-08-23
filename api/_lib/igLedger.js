/**
 * IG 일별 장부 — 팔로워 증가의 출처를 하루 단위로 대조한다 (2026-08-22)
 * ────────────────────────────────────────────────────────────────────
 * 도메니코: "팔로워가 획기적으로 늘 수 있는 컨디션" → 1번 과제
 * "61% 사각지대 좁히기 — 게시 시각·형식별로 그날 팔로워 증가를 대조하는 일별 장부"
 *
 * ■ 왜 이 장부인가 — per-media 로는 영영 못 보는 것이 있다
 *
 * 실측(2026-08-22 확정):
 *   · 캐러셀·이미지  follows 를 게시물 단위로 준다 (수집률 100%)
 *   · 영상(릴스)     안 준다 — 1,078건 캡처, 수집 0건. 영구 사각지대.
 *   · 30일 팔로워 +5,468 중 게시물로 설명되는 건 2,124(38.8%).
 *     나머지 3,344(61.2%)의 출처를 모른다 — 릴스·프로필 방문·스토리.
 *
 * 게시물 단위가 막혔으니 남은 계기는 하루 단위다:
 *   그날 팔로워 증가(실측) − 그날 게시물에 귀속된 팔로우(캐러셀+이미지)
 *   = 그날의 "설명 안 되는 증가" (릴스+프로필+스토리+기타)
 * 이 잔차를 '그날 릴스를 몇 편 올렸나'와 나란히 두면, 게시물 단위로는
 * 못 보는 릴스의 기여가 **일 단위 상관**으로 드러난다. 추정이지 확정이
 * 아니다 — 그래서 r 값과 표본 수를 항상 같이 싣는다.
 *
 * ■ 정직한 한계 (렌더에도 싣는다)
 *   · 귀속은 "게시일" 기준이다. 팔로우는 게시 후 며칠에 걸쳐 쌓이므로
 *     하루하루는 어긋난다. 주 단위 합계에서 수렴한다.
 *   · 잔차에는 릴스만이 아니라 스토리·프로필·외부 유입이 다 섞여 있다.
 *     상관은 방향 신호지 인과 증명이 아니다.
 *
 * 순수 계산(computeLedger·pearson)과 조회(buildIgLedger)를 분리한다 —
 * 테스트가 supabase 없이 계산을 실제로 실행하기 위해서다.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

const HANDLE = 'pap_magazine';

/** UTC ISO → KST 달력 날짜. 도메니코의 하루는 KST 다. */
function kstDay(iso) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 피어슨 상관 — 소표본 방향 신호용. n<8 이면 null (잡음 판정 방지). */
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 8) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = Number(xs[i]) || 0, y = Number(ys[i]) || 0;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const cov = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (!den) return null;
  return Math.round((cov / den) * 1000) / 1000;
}

/**
 * 순수 계산 — 일별 장부.
 * @param {Array<{day:string, followers:number}>} dailyFollowers  KST 일별 팔로워 (그날 최대값)
 * @param {Array<{post_id:string, media_type:string, posted_at:string, follows:number|null}>} posts
 *        게시물별 최종 캡처 1행 (posted_at 은 UTC ISO)
 */
function computeLedger(dailyFollowers, posts) {
  const byDay = new Map();
  const sorted = [...(dailyFollowers || [])].sort((a, b) => a.day < b.day ? -1 : 1);
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i].followers - sorted[i - 1].followers;
    byDay.set(sorted[i].day, {
      day: sorted[i].day, delta,
      carousels: 0, videos: 0, images: 0, posts: 0,
      attributed: 0, attributedKnown: true,
    });
  }
  for (const p of posts || []) {
    const d = kstDay(p.posted_at);
    const row = d && byDay.get(d);
    if (!row) continue;   // 스냅샷 없는 날은 delta 를 모르므로 장부에서 뺀다
    row.posts++;
    const mt = String(p.media_type || '').toUpperCase();
    if (mt === 'CAROUSEL_ALBUM') row.carousels++;
    else if (mt === 'VIDEO' || mt === 'REELS') row.videos++;
    else if (mt === 'IMAGE') row.images++;
    if (typeof p.follows === 'number') {
      row.attributed += p.follows;
      /* 형식별 귀속 — 2번 과제(캐러셀 비중 리포트). 실측 60일: 캐러셀이
         팔로우의 99.8% 를 만들고 단일 이미지는 도달이 높아도 팔로우가
         15.6배 낮다. 그 격차가 매주 눈에 보여야 편성 판단 재료가 된다. */
      if (mt === 'CAROUSEL_ALBUM') row.attrCarousels = (row.attrCarousels || 0) + p.follows;
      else if (mt === 'IMAGE') row.attrImages = (row.attrImages || 0) + p.follows;
    }
  }
  const days = [...byDay.values()].sort((a, b) => a.day < b.day ? -1 : 1)
    .map((r) => ({ ...r, residual: r.delta - r.attributed }));

  const sum = (k) => days.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const totalDelta = sum('delta');
  const totalAttr = sum('attributed');
  const summary = {
    days: days.length,
    totalDelta,
    totalAttributed: totalAttr,
    totalResidual: totalDelta - totalAttr,
    explainedPct: totalDelta ? Math.round(1000 * totalAttr / totalDelta) / 10 : null,
    posts: { carousels: sum('carousels'), videos: sum('videos'), images: sum('images') },
    followsByFormat: {
      carousels: sum('attrCarousels'),
      images: sum('attrImages'),
      perCarousel: sum('carousels') ? Math.round(10 * sum('attrCarousels') / sum('carousels')) / 10 : null,
      perImage: sum('images') ? Math.round(10 * sum('attrImages') / sum('images')) / 10 : null,
    },
    /* 잔차 ↔ 그날 릴스 편수 — 릴스 기여의 유일한 계기 (방향 신호) */
    corrVideosResidual: pearson(days.map((r) => r.videos), days.map((r) => r.residual)),
    corrCarouselsResidual: pearson(days.map((r) => r.carousels), days.map((r) => r.residual)),
    /* 릴스 올린 날 vs 안 올린 날의 잔차 평균 — 상관보다 읽기 쉬운 보조 지표 */
    residualOnVideoDays: avgResidual(days, (r) => r.videos > 0),
    residualOnNoVideoDays: avgResidual(days, (r) => r.videos === 0),
  };
  return { days, summary };
}

function avgResidual(days, cond) {
  const hit = days.filter(cond);
  if (!hit.length) return null;
  return Math.round(hit.reduce((s, r) => s + r.residual, 0) / hit.length);
}

/** 조회 + 계산. 실패는 던진다 — 호출부(주간 브리핑)가 try/catch 로 감싼다. */
async function buildIgLedger(days) {
  const n = Math.max(7, Math.min(60, Number(days) || 28));
  const sinceIso = new Date(Date.now() - (n + 1) * 86400000).toISOString();

  /* 하루 최대 팔로워 (KST) — 스냅샷은 3시간마다 찍힌다 */
  const { data: snaps, error: e1 } = await supabaseAdmin
    .from('ig_account_snapshot')
    .select('captured_at, followers')
    .eq('handle', HANDLE)
    .gte('captured_at', sinceIso)
    .order('captured_at', { ascending: true })
    .limit(5000);
  if (e1) throw new Error('ig_account_snapshot: ' + e1.message);
  const dayMax = new Map();
  for (const s of snaps || []) {
    const d = kstDay(s.captured_at);
    if (!d) continue;
    dayMax.set(d, Math.max(dayMax.get(d) || 0, Number(s.followers) || 0));
  }
  const dailyFollowers = [...dayMax.entries()].map(([day, followers]) => ({ day, followers }));

  /* 게시물별 최종 캡처 1행 — age_hours 최대가 가장 익은 수치다 */
  const { data: metrics, error: e2 } = await supabaseAdmin
    .from('ig_post_metric')
    .select('post_id, media_type, posted_at, follows, age_hours')
    .gte('posted_at', sinceIso)
    .order('age_hours', { ascending: false })
    .limit(20000);
  if (e2) throw new Error('ig_post_metric: ' + e2.message);
  const latest = new Map();
  for (const m of metrics || []) {
    if (m && m.post_id && !latest.has(m.post_id)) latest.set(m.post_id, m);
  }
  const ledger = computeLedger(dailyFollowers, [...latest.values()]);

  /* ── 이탈 병합 (2026-08-22) — ig_follower_flux 가 있으면 gains·이탈을 붙인다.
     표가 없거나(마이그레이션 134 전) 비어 있으면 조용히 그대로 — 장부 본체는
     flux 에 인질 잡히지 않는다. 이탈 = gains − net, 도출은 igFlux 한 곳에서. */
  try {
    const { data: fluxRows } = await supabaseAdmin
      .from('ig_follower_flux').select('day, gains')
      .gte('day', new Date(Date.now() - (n + 1) * 86400000).toISOString().slice(0, 10))
      .order('day', { ascending: true }).limit(120);
    if (fluxRows && fluxRows.length) {
      const { computeUnfollows } = require('./igFlux');
      ledger.days = computeUnfollows(fluxRows, ledger.days);
      const known = ledger.days.filter((d) => typeof d.unfollows === 'number');
      ledger.summary.unfollowDays = known.length;
      ledger.summary.totalUnfollows = known.reduce((x, d) => x + d.unfollows, 0);
      ledger.summary.totalGains = known.reduce((x, d) => x + (d.gains || 0), 0);
    }
  } catch (e) { console.warn('[igLedger] flux 병합 실패(비치명):', e && e.message); }

  return ledger;
}

/** 마크다운 렌더 — 주간 브리핑에 붙는다. 최근 7일 행 + 기간 요약. */
function renderIgLedgerMd(ledger) {
  if (!ledger || !ledger.days || !ledger.days.length) return '';
  const s = ledger.summary;
  const last7 = ledger.days.slice(-7);
  const L = [];
  L.push('## IG 일별 장부 — 팔로워 증가의 출처');
  L.push('');
  const hasFlux = last7.some((r) => typeof r.unfollows === 'number');
  if (hasFlux) {
    L.push('| 날짜(KST) | 신규 | 이탈 | 순증 | 게시물귀속 | 잔차 | 캐러셀 | 릴스 |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const r of last7) {
      L.push(`| ${r.day} | ${r.gains == null ? '—' : r.gains} | ${r.unfollows == null ? '—' : r.unfollows} | ${r.delta} | ${r.attributed} | ${r.residual} | ${r.carousels} | ${r.videos} |`);
    }
  } else {
    L.push('| 날짜(KST) | 증가 | 게시물귀속 | 잔차 | 캐러셀 | 릴스 | 이미지 |');
    L.push('|---|---|---|---|---|---|---|');
    for (const r of last7) {
      L.push(`| ${r.day} | ${r.delta} | ${r.attributed} | ${r.residual} | ${r.carousels} | ${r.videos} | ${r.images} |`);
    }
  }
  L.push('');
  L.push(`${s.days}일 합계: 증가 **${s.totalDelta}** · 게시물 귀속 ${s.totalAttributed}`
    + ` (${s.explainedPct == null ? '—' : s.explainedPct + '%'}) · 잔차 **${s.totalResidual}**`);
  if (typeof s.totalUnfollows === 'number') {
    L.push(`이탈(${s.unfollowDays}일 측정): 신규 ${s.totalGains} − 이탈 **${s.totalUnfollows}** = 순증`
      + ` · 하루 평균 이탈 ${s.unfollowDays ? Math.round(s.totalUnfollows / s.unfollowDays) : '—'}`);
  }
  const f = s.followsByFormat || {};
  L.push(`형식별 귀속 팔로우: 캐러셀 ${f.carousels || 0}`
    + (f.perCarousel != null ? ` (편당 ${f.perCarousel})` : '')
    + ` · 이미지 ${f.images || 0}` + (f.perImage != null ? ` (편당 ${f.perImage})` : '')
    + ' · 릴스 측정불가(잔차로만)');
  if (s.corrVideosResidual != null) {
    L.push(`잔차↔그날 릴스 편수 상관 r=${s.corrVideosResidual}`
      + ` · 릴스 올린 날 잔차 평균 ${s.residualOnVideoDays} vs 안 올린 날 ${s.residualOnNoVideoDays}`);
  }
  L.push('');
  L.push('_읽는 법: 귀속은 게시일 기준이라 하루 단위는 어긋난다(주 합계에서 수렴)._');
  L.push('_잔차 = 릴스+스토리+프로필+기타. 릴스는 인스타가 per-media 지표를 안 줘(확정) 이 장부가 유일한 계기다. 상관은 방향 신호지 인과가 아니다._');
  return L.join('\n');
}

module.exports = { computeLedger, buildIgLedger, renderIgLedgerMd, pearson, kstDay, HANDLE };
