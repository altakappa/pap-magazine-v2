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
 * [유형] ig_post_latest(144·146·147)의 매칭 필드로 나눈다. 9/6 진단 노트의 분류와 같다.
 *   화보            : content_kind='editorial' (editorials 테이블 실제 매칭)
 *   셀럽·직접취재    : digest_kind=celeb AND pap_shot(캡션에 🎥/📸 PAP 마커)
 *   셀럽·보도자료    : digest_kind=celeb AND NOT pap_shot
 *   기사·직접취재    : 그 외 AND pap_shot
 *   기사·외부소스    : 그 외
 *   미매칭          : content_kind='unmatched' (기사도 화보도 아닌 것)
 *
 * [2026-09-08 정정] 처음엔 `article_id 없음 → 화보` 로 **추정**했다. 실측하니 기사
 * 매칭 없는 31행 중 26행만 editorials 와 매칭되고 5행은 진짜 미매칭이었다. 즉 화보
 * 수가 16% 부풀어 있었다. 마이그레이션 147 이 editorials 조인을 붙였으므로 이제
 * 추정이 아니라 조인 결과(content_kind)를 읽는다. 147 이전에 뽑은 행에는 그 열이
 * 없으므로 옛 추정 규칙을 폴백으로 남긴다.
 *
 * [형태] post_form (147). 유형과 **다른 축**이다 — 유형은 '누가 만들었나',
 * 형태는 '어떤 모양인가'. 9/6 진단이 남긴 숙제("같은 기사인데 팔로우 전환이 20배
 * 갈린다, 지금 비율은 실측 필요")를 세는 열이다.
 *   editorial 화보 · visual 이미지가 주인공 · namenews 이름이 주인공 · onsite 현장 · none
 *
 * [원칙] 원본 수치만. 게시 20시간 이상 지난 것만(초기치 왜곡 방지). 릴스 follows 는
 * API 가 안 주므로 수동 기록(146)이 있을 때만 잡힌다 — 없으면 '—' 로 둔다.
 */
'use strict';

const { supabaseAdmin } = require('./supabase');

const TYPES = ['화보', '셀럽·직접취재', '셀럽·보도자료', '기사·직접취재', '기사·외부소스', '미매칭'];
const { ALL_FORMS } = require('./postForm');
/** 표에 쓰는 한국어 이름. 값 자체는 DB 와 같은 영문으로 둔다(규칙이 두 벌이면 안 된다). */
const FORM_LABEL = { editorial: '화보', visual: '작업물이 주인공', namenews: '이름이 주인공', onsite: '현장 취재', none: '해당 없음', '(미판정)': '미판정' };
const HIT_REACH = 50000;
const MIN_AGE_H = 20;

function classify(r) {
  if (!r) return '기사·외부소스';
  /* 147 이후: 조인 결과를 그대로 읽는다 */
  const ck = String(r.content_kind || '').toLowerCase();
  if (ck === 'editorial') return '화보';
  if (ck === 'unmatched') return '미매칭';
  /* 147 이전 행 폴백 — 옛 추정 규칙 (화보를 16% 부풀린다, 위 머리말 참고) */
  if (!ck && (!r.article_id || String(r.article_category || '').toLowerCase() === 'editorial')) return '화보';
  const celeb = String(r.digest_kind || '').toLowerCase() === 'celeb';
  const shot = !!r.pap_shot;
  if (celeb) return shot ? '셀럽·직접취재' : '셀럽·보도자료';
  return shot ? '기사·직접취재' : '기사·외부소스';
}

/** 형태. 값이 없으면 '(미판정)' — 모르는 것을 아는 척하지 않는다. */
function formOf(r) {
  const v = String((r && r.post_form) || '').toLowerCase();
  return ALL_FORMS.includes(v) ? v : '(미판정)';
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
  /* 형태 버킷은 유형과 따로 센다 — 축이 다르므로 합치면 둘 다 못 읽는다.
     '(미판정)' 도 칸을 준다: 라벨이 안 붙은 게 몇 건인지 보여야 계측기를 믿을 수 있다. */
  const FKEYS = ALL_FORMS.concat(['(미판정)']);
  const fmk = () => { const o = {}; FKEYS.forEach((f) => { o[f] = bucket(); }); return o; };
  const fcur = fmk(), fprev = fmk();
  const hitList = [];
  for (const r of rows || []) {
    const t = Date.parse(r.posted_at);
    if (isNaN(t) || t < d14 || t > now) continue;
    if (Number(r.age_hours) < MIN_AGE_H) continue;
    const type = classify(r);
    const side = t >= d7 ? cur : prev;
    const fside = t >= d7 ? fcur : fprev;
    const reach = Number(r.reach) || 0;
    const isReel = String(r.media_type || '').toUpperCase() === 'VIDEO';
    const add = (b) => {
      b.posts++;
      if (isReel) b.reels++;
      b.reach.push(reach); b.reachSum += reach;
      b.saves += Number(r.saved) || 0;
      b.shares += Number(r.shares) || 0;
      if (reach >= HIT_REACH) b.hits++;
      if (typeof r.follows === 'number' && reach > 0) { b.fReach += reach; b.fSum += r.follows; b.fPosts++; }
    };
    add(side[type]);
    add(fside[formOf(r)]);
    if (t >= d7) hitList.push({ type, title: r.article_title || null, permalink: r.permalink,
      media_type: r.media_type, reach, saves: Number(r.saved) || 0, shares: Number(r.shares) || 0,
      follows: typeof r.follows === 'number' ? r.follows : null,
      shares_1k: per1k(Number(r.shares) || 0, reach), saves_1k: per1k(Number(r.saved) || 0, reach) });
  }
  const finKeys = (side, keys) => keys.map((type) => {
    const b = side[type];
    return { type, posts: b.posts, reels: b.reels, medReach: median(b.reach), reachSum: b.reachSum,
      hits: b.hits, saves_1k: per1k(b.saves, b.reachSum), shares_1k: per1k(b.shares, b.reachSum),
      follows_1k: b.fPosts ? per1k(b.fSum, b.fReach) : null, followsPosts: b.fPosts, followsSum: b.fSum };
  });
  const fin = (side) => finKeys(side, TYPES);
  const topShares = hitList.filter((h) => h.reach >= 3000).sort((a, b) => (b.shares_1k || 0) - (a.shares_1k || 0)).slice(0, 5);
  const topFollows = hitList.filter((h) => h.follows != null).sort((a, b) => (b.follows || 0) - (a.follows || 0)).slice(0, 5);
  const totalCur = fin(cur), totalPrev = fin(prev);
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return {
    cur: totalCur, prev: totalPrev, topShares, topFollows,
    forms: finKeys(fcur, FKEYS), formsPrev: finKeys(fprev, FKEYS),
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
    .select('post_id, permalink, media_type, posted_at, age_hours, reach, saved, shares, follows, article_id, article_title, article_category, digest_kind, pap_shot, content_kind, post_form')
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
  const fr = (mix.forms || []).filter((r) => r.posts);
  if (fr.length) {
    const fprevBy = {}; (mix.formsPrev || []).forEach((r) => { fprevBy[r.type] = r; });
    L.push('');
    L.push('### 형태별 (같은 7일 · 유형과 다른 축이다)');
    L.push('');
    L.push('> 유형은 "누가 만들었나", 형태는 "게시물이 어떤 모양인가". 9/6 진단이 남긴 숙제 —');
    L.push('> "같은 기사인데 팔로우 전환이 20배 갈린다, 지금 비율은 실측 필요" — 를 세는 표다.');
    L.push('');
    L.push('| 형태 | 게시물(릴스) | 도달 중앙값 | 5만+ 히트 | 저장/1k | 공유/1k | 팔로우/1k |');
    L.push('|---|---|---|---|---|---|---|');
    for (const r of fr) {
      const f = r.follows_1k == null ? '—' : (r.follows_1k + ' (' + r.followsPosts + '편)');
      const prevN = (fprevBy[r.type] && fprevBy[r.type].posts) || 0;
      L.push('| ' + (FORM_LABEL[r.type] || r.type) + ' | ' + r.posts + ' (' + r.reels + ')'
        + (prevN ? ' ← 전주 ' + prevN : '') + ' | ' + fmt(r.medReach) + ' | ' + r.hits + ' | '
        + fmt(r.saves_1k) + ' | ' + fmt(r.shares_1k) + ' | ' + f + ' |');
    }
    const undone = fr.find((r) => r.type === '(미판정)');
    if (undone) L.push('');
    if (undone) L.push('_미판정 ' + undone.posts + '편은 형태 라벨이 아직 안 붙은 것이다 (크론이 10분마다 채운다). 이 숫자가 안 줄면 계측기가 멈춘 것이다._');
  }
  L.push('');
  L.push('_읽는 법: 유형 간 차이가 게시물 수 차이보다 크다(9/6 실측: 화보 1.06/1k vs 셀럽 보도자료 0.15/1k). 히트가 0 인 주는 소재 선택의 문제지 배포의 문제가 아니다 — 도달 중앙값이 7~9k 로 유지되는 한._');
  return L.join('\n');
}

module.exports = { buildIgContentMix, computeContentMix, renderContentMixMd, classify, formOf, TYPES, FORM_LABEL, HIT_REACH, MIN_AGE_H };
