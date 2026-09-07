/**
 * PAP Magazine — IG 소재 유형별 성적표 (2026-09-07 신설)
 *
 * [왜]
 * 도메니코: "한두 달 전과 비교했을 때 팔로워 증가도 인사이트도 전부 엄청나게 하락했다.
 * 폭발적으로 성장할 수 있도록 코드를 짜달라."
 * 실측(ig_post_metric 24h, 7/27~9/6): 게시물당 저장/1k·공유/1k 는 오히려 최고치(10.2·26.8).
 * 도달 중앙값은 9.2k→7.4k 로 20% 낮을 뿐. 사라진 건 **5만+ 히트**(주 3~4개 → 0개)이고
 * 팔로워는 히트가 만들었다(귀여운 얼굴 1편 = 팔로우 1,091). 히트는 코드가 아니라 소재가 만든다.
 * 그래서 코드가 할 일은 "어떤 소재가 히트를 내고 팔로우를 만드는지"를 매주 같은 표로 보여
 * 편성 회의가 감이 아니라 숫자로 소재를 고르게 하는 것이다.
 *
 * [유형] ig_post_latest(144·146)의 기사 매칭 필드로 나눈다. 9/6 진단 노트의 분류와 같다.
 *   화보            : 기사 매칭 없음 또는 category=editorial
 *   셀럽·직접취재    : digest_kind=celeb AND pap_shot(캡션에 🎥/📸 PAP 마커)
 *   셀럽·보도자료    : digest_kind=celeb AND NOT pap_shot
 *   기사·직접취재    : 그 외 AND pap_shot
 *   기사·외부소스    : 그 외
 *
 * [원칙] 원본 수치만. 게시 20시간 이상 지난 것만(초기치 왜곡 방지). 릴스 follows 는
 * API 가 안 주므로 수동 기록(146)이 있을 때만 잡힌다 — 없으면 '—' 로 둔다.
 */
'use strict';

const { supabaseAdmin } = require('./supabase');

const TYPES = ['화보', '셀럽·직접취재', '셀럽·보도자료', '기사·직접취재', '기사·외부소스'];
const HIT_REACH = 50000;
const MIN_AGE_H = 20;

function classify(r) {
  if (!r) return '기사·외부소스';
  if (!r.article_id || String(r.article_category || '').toLowerCase() === 'editorial') return '화보';
  const celeb = String(r.digest_kind || '').toLowerCase() === 'celeb';
  const shot = !!r.pap_shot;
  if (celeb) return shot ? '셀럽·직접취재' : '셀럽·보도자료';
  return shot ? '기사·직접취재' : '기사·외부소스';
}

function median(nums) {
  const a = nums.filter((n) => typeof n === 'number' && !isNaN(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
const per1k = (num, den) => den > 0 ? Math.round(10 * 1000 * num / den) / 10 : null;

/** 순수 계산 — rows 는 ig_post_latest 행(age_hours ≥ MIN_AGE_H 로 걸러 넘긴다) */
function computeContentMix(rows, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const d7 = now - 7 * 86400000, d14 = now - 14 * 86400000;
  const bucket = () => ({ posts: 0, reels: 0, reach: [], reachSum: 0, saves: 0, shares: 0,
    hits: 0, fReach: 0, fSum: 0, fPosts: 0 });
  const mk = () => { const o = {}; TYPES.forEach((t) => { o[t] = bucket(); }); return o; };
  const cur = mk(), prev = mk();
  const hitList = [];
  for (const r of rows || []) {
    const t = Date.parse(r.posted_at);
    if (isNaN(t) || t < d14 || t > now) continue;
    if (Number(r.age_hours) < MIN_AGE_H) continue;
    const type = classify(r);
    const side = t >= d7 ? cur : prev;
    const b = side[type];
    const reach = Number(r.reach) || 0;
    b.posts++;
    if (String(r.media_type || '').toUpperCase() === 'VIDEO') b.reels++;
    b.reach.push(reach); b.reachSum += reach;
    b.saves += Number(r.saved) || 0;
    b.shares += Number(r.shares) || 0;
    if (reach >= HIT_REACH) b.hits++;
    if (typeof r.follows === 'number' && reach > 0) { b.fReach += reach; b.fSum += r.follows; b.fPosts++; }
    if (t >= d7) hitList.push({ type, title: r.article_title || null, permalink: r.permalink,
      media_type: r.media_type, reach, saves: Number(r.saved) || 0, shares: Number(r.shares) || 0,
      follows: typeof r.follows === 'number' ? r.follows : null,
      shares_1k: per1k(Number(r.shares) || 0, reach), saves_1k: per1k(Number(r.saved) || 0, reach) });
  }
  const fin = (side) => TYPES.map((type) => {
    const b = side[type];
    return { type, posts: b.posts, reels: b.reels, medReach: median(b.reach), reachSum: b.reachSum,
      hits: b.hits, saves_1k: per1k(b.saves, b.reachSum), shares_1k: per1k(b.shares, b.reachSum),
      follows_1k: b.fPosts ? per1k(b.fSum, b.fReach) : null, followsPosts: b.fPosts, followsSum: b.fSum };
  });
  const topShares = hitList.filter((h) => h.reach >= 3000).sort((a, b) => (b.shares_1k || 0) - (a.shares_1k || 0)).slice(0, 5);
  const topFollows = hitList.filter((h) => h.follows != null).sort((a, b) => (b.follows || 0) - (a.follows || 0)).slice(0, 5);
  const totalCur = fin(cur), totalPrev = fin(prev);
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return {
    cur: totalCur, prev: totalPrev, topShares, topFollows,
    summary: {
      posts: sum(totalCur, 'posts'), postsPrev: sum(totalPrev, 'posts'),
      hits: sum(totalCur, 'hits'), hitsPrev: sum(totalPrev, 'hits'),
      reach: sum(totalCur, 'reachSum'), reachPrev: sum(totalPrev, 'reachSum'),
    },
  };
}

async function buildIgContentMix(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const since = new Date(now - 15 * 86400000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('ig_post_latest')
    .select('post_id, permalink, media_type, posted_at, age_hours, reach, saved, shares, follows, article_id, article_title, article_category, digest_kind, pap_shot')
    .gte('posted_at', since)
    .order('posted_at', { ascending: false })
    .limit(1500);
  if (error) throw new Error('ig_post_latest: ' + error.message);
  return computeContentMix(data || [], now);
}

const fmt = (v, suffix) => (v == null ? '—' : String(v) + (suffix || ''));
const delta = (cur, prev) => {
  if (!prev && !cur) return '—';
  if (!prev) return 'NEW';
  const p = Math.round(((cur - prev) / prev) * 100);
  return (p >= 0 ? '+' : '') + p + '%';
};
function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/** 브리핑에 그대로 붙는 결정론 마크다운 (AI 산출물 아님). 게시물이 없으면 빈 문자열. */
function renderContentMixMd(mix) {
  if (!mix || !mix.summary || !mix.summary.posts) return '';
  const s = mix.summary;
  const L = [
    '## IG 소재 유형별 성적표 (지난 7일 · 게시 20시간 이상 지난 것만)',
    '',
    '> 히트(도달 5만+)가 팔로워를 만든다. 이 표는 "어떤 소재가 히트와 팔로우를 내는가"를 매주 같은 자로 잰다.',
    '> 릴스 팔로우는 API 가 안 준다 — 텔레그램 "팔로우 <숏코드> <숫자>" 로 적은 것만 잡힌다.',
    '',
    '| 유형 | 게시물(릴스) | 도달 중앙값 | 5만+ 히트 | 저장/1k | 공유/1k | 팔로우/1k |',
    '|---|---|---|---|---|---|---|',
  ];
  const prevBy = {}; (mix.prev || []).forEach((r) => { prevBy[r.type] = r; });
  for (const r of mix.cur) {
    if (!r.posts && !(prevBy[r.type] && prevBy[r.type].posts)) continue;
    const f = r.follows_1k == null ? '—' : (r.follows_1k + ' (' + r.followsPosts + '편)');
    L.push('| ' + r.type + ' | ' + r.posts + ' (' + r.reels + ') | ' + fmt(r.medReach) + ' | ' + r.hits + ' | '
      + fmt(r.saves_1k) + ' | ' + fmt(r.shares_1k) + ' | ' + f + ' |');
  }
  L.push('| **합계** | **' + s.posts + '** (' + delta(s.posts, s.postsPrev) + ') | | **' + s.hits + '** (전주 ' + s.hitsPrev + ') | | | |');
  L.push('');
  L.push('총도달 ' + s.reach.toLocaleString('en-US') + ' (전주 ' + s.reachPrev.toLocaleString('en-US') + ', ' + delta(s.reach, s.reachPrev) + ')');
  if (mix.topShares && mix.topShares.length) {
    L.push('');
    L.push('**이번 주 공유 효율 TOP 5 (공유/1k · 도달 3천 이상)** — 다음 주 소재 후보');
    L.push('');
    mix.topShares.forEach((h, i) => {
      L.push((i + 1) + '. [' + h.type + (h.media_type === 'VIDEO' ? '·릴스' : '') + '] ' + short(h.title || h.permalink, 40)
        + ' — 공유 ' + h.shares_1k + '/1k · 저장 ' + h.saves_1k + '/1k · 도달 ' + h.reach.toLocaleString('en-US') + ' · ' + h.permalink);
    });
  }
  if (mix.topFollows && mix.topFollows.length) {
    L.push('');
    L.push('**이번 주 팔로우 TOP 5 (실측: API 캐러셀 + 수동 기록 릴스)**');
    L.push('');
    mix.topFollows.forEach((h, i) => {
      L.push((i + 1) + '. [' + h.type + (h.media_type === 'VIDEO' ? '·릴스' : '') + '] ' + short(h.title || h.permalink, 40)
        + ' — 팔로우 ' + h.follows + ' · 도달 ' + h.reach.toLocaleString('en-US') + ' · ' + h.permalink);
    });
  }
  L.push('');
  L.push('_읽는 법: 유형 간 차이가 게시물 수 차이보다 크다(9/6 실측: 화보 1.06/1k vs 셀럽 보도자료 0.15/1k). 히트가 0 인 주는 소재 선택의 문제지 배포의 문제가 아니다 — 도달 중앙값이 7~9k 로 유지되는 한._');
  return L.join('\n');
}

module.exports = { buildIgContentMix, computeContentMix, renderContentMixMd, classify, TYPES, HIT_REACH, MIN_AGE_H };
