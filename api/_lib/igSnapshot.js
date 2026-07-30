/**
 * PAP Magazine — 인스타그램 성과 스냅샷 (2026-07-21 신설)
 *
 * 왜: "참여가 줄어든 것 같다"를 검증할 데이터가 없었다. Graph API 에서
 * like_count 를 받아오면서도 저장하지 않아, 매번 게시 빈도 같은 간접 증거로
 * 추측해야 했다. 3시간마다 실측치를 남겨 추세를 그래프로 답할 수 있게 한다.
 *
 * 저장 위치: ig_account_snapshot(팔로워) / ig_post_metric(게시물별 좋아요·댓글)
 * — migration 085.
 *
 * 순수 로직(집계·리포트)은 네트워크를 타지 않으므로 테스트에서 직접 검증한다.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

const GRAPH = 'https://graph.facebook.com/v21.0';
const SELF_HANDLE = 'pap_magazine';

/* ── 수집 ────────────────────────────────────────────────────────── */

/** 본 계정의 최근 게시물 + 팔로워 수를 한 번에 가져온다 (Graph API 2콜). */
async function fetchSnapshot(opts) {
  const token = process.env.IG_ACCESS_TOKEN;
  const userId = process.env.IG_USER_ID;
  if (!token || !userId) throw new Error('IG env 미설정');
  const limit = Math.max(1, Math.min(50, (opts && opts.limit) || 25));

  const acctUrl = `${GRAPH}/${userId}?fields=followers_count,media_count,username`
    + `&access_token=${encodeURIComponent(token)}`;
  const mediaUrl = `${GRAPH}/${userId}/media`
    + `?fields=id,permalink,media_type,timestamp,like_count,comments_count`
    + `&limit=${limit}&access_token=${encodeURIComponent(token)}`;

  const [acctRes, mediaRes] = await Promise.all([
    fetch(acctUrl, { signal: AbortSignal.timeout(15000) }),
    fetch(mediaUrl, { signal: AbortSignal.timeout(15000) }),
  ]);
  if (!acctRes.ok) throw new Error('account ' + acctRes.status);
  if (!mediaRes.ok) throw new Error('media ' + mediaRes.status);

  const acct = await acctRes.json();
  const media = await mediaRes.json();
  return {
    account: {
      handle: acct.username || SELF_HANDLE,
      followers: typeof acct.followers_count === 'number' ? acct.followers_count : null,
      media_count: typeof acct.media_count === 'number' ? acct.media_count : null,
    },
    posts: Array.isArray(media.data) ? media.data : [],
  };
}

/** 숫자면 그대로, 아니면 null (0 으로 속이지 않는다). */
function numOrNull(v) { return typeof v === 'number' ? v : null; }

/** 게시물 1건의 인사이트(저장·공유·도달·재생·총상호작용)를 가져온다.
 *  media_type 별로 유효 metric 이 달라, 실패하면 축소 세트로 재시도하고
 *  그래도 안 되면 {} 를 돌려준다 — 좋아요·댓글 저장은 절대 막지 않는다. */
async function fetchPostInsights(mediaId, mediaType, token) {
  if (!mediaId || !token) return {};
  const mt = String(mediaType || '').toUpperCase();

  /* 2026-07-30 — profile_visits·follows·views 추가.
   *
   * 왜: 지금까지 저장한 도달·좋아요·저장은 전부 '대리지표' 다. 팔로워가 늘었는지
   * 아닌지를 게시물 단위로 답할 수 없었다(도달 2만인데 팔로우 0 vs 도달 5천인데
   * 팔로우 50 을 구분 못 함). follows 가 유일한 직접 지표다.
   *
   * views: 기존엔 'plays' 만 요청했는데 750건 중 0건이 수집됐다. Instagram 이
   * plays 를 views 로 교체(v22+)했기 때문이다. 세트에 하나라도 지원 안 되는
   * metric 이 있으면 응답 전체가 400 이라, plays 때문에 릴스는 늘 축소 세트로
   * 떨어져 shares 까지 함께 잃고 있었다(shares 461/750 만 수집된 이유).
   *
   * 그래서 계단식으로 좁힌다 — 넓은 세트부터 시도해 되는 만큼 가져온다.
   * 신규 필드가 계정 권한·미디어 타입에 따라 거부돼도 기존 수집은 안 깨진다. */
  const CONVERSION = ['profile_visits', 'follows'];
  const BASE = ['reach', 'saved', 'shares', 'total_interactions'];
  const isVideo = (mt === 'VIDEO' || mt === 'REELS');
  const ladder = [
    isVideo ? [...BASE, 'views', ...CONVERSION] : [...BASE, ...CONVERSION],
    isVideo ? [...BASE, 'views'] : [...BASE],
    isVideo ? ['reach', 'saved', 'views'] : ['reach', 'saved'],
    ['reach', 'saved'],
  ];
  for (const metrics of ladder) {
    try {
      const url = `${GRAPH}/${encodeURIComponent(mediaId)}/insights`
        + `?metric=${metrics.join(',')}&access_token=${encodeURIComponent(token)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const j = await r.json();
      const out = {};
      for (const m of (j.data || [])) {
        const v = m && m.values && m.values[0] ? m.values[0].value : undefined;
        if (typeof v === 'number') out[m.name] = v;
      }
      // 구 API 는 plays, 신 API 는 views. 둘 중 오는 쪽을 views 로 통일한다.
      if (typeof out.plays === 'number' && typeof out.views !== 'number') out.views = out.plays;
      return {
        saved: out.saved, shares: out.shares, reach: out.reach,
        views: out.views, total_interactions: out.total_interactions,
        profile_visits: out.profile_visits, follows: out.follows,
      };
    } catch (_) { /* 다음 metric 세트로 재시도 */ }
  }
  return {};
}

/** Graph 응답 → ig_post_metric 행. age_hours 를 여기서 계산한다. */
function toMetricRows(posts, now) {
  const t = now || Date.now();
  // id 없는 항목은 먼저 버린다 — String(undefined) 는 'undefined' 라는
  // 그럴듯한 문자열이 되어 쓰레기 행이 저장된다.
  return (posts || []).filter(p => p && p.id).map((p) => {
    const posted = p.timestamp ? Date.parse(p.timestamp) : NaN;
    const age = isNaN(posted) ? null : Math.round(((t - posted) / 3600000) * 100) / 100;
    return {
      post_id: String(p.id),
      permalink: p.permalink || null,
      media_type: p.media_type || null,
      posted_at: isNaN(posted) ? null : new Date(posted).toISOString(),
      like_count: typeof p.like_count === 'number' ? p.like_count : null,
      comments_count: typeof p.comments_count === 'number' ? p.comments_count : null,
      age_hours: age,
      saved: numOrNull(p.saved),
      shares: numOrNull(p.shares),
      reach: numOrNull(p.reach),
      views: numOrNull(p.views),
      total_interactions: numOrNull(p.total_interactions),
      // 2026-07-30 — 팔로워 전환. 미지원이면 null 로 남는다(0 으로 속이지 않는다).
      profile_visits: numOrNull(p.profile_visits),
      follows: numOrNull(p.follows),
    };
  });
}

/* ── 팔로워 국가 구성 (2026-07-30 신설) ─────────────────────────────
 *
 * "한국인 진성 팔로워가 늘고 있는가" — 도메니코의 목표인데 이 질문에 답할
 * 데이터가 없었다. 미디어킷의 "도달 1위 서울" 은 스크린샷 한 장이지 추이가 아니다.
 *
 * Instagram 은 이 지표의 API 를 두 번 바꿨다. 신형(follower_demographics,
 * breakdown=country)을 먼저 시도하고 실패하면 구형(audience_country)으로
 * 내려간다 — 어느 쪽이 살아 있든 수집이 끊기지 않게.
 * 팔로워 100명 미만 계정은 프라이버시 정책상 아예 안 준다(PAP 는 해당 없음).
 */
async function fetchAudienceCountries(token, userId) {
  const attempts = [
    `${GRAPH}/${userId}/insights?metric=follower_demographics&period=lifetime`
      + `&metric_type=total_value&breakdown=country`,
    `${GRAPH}/${userId}/insights?metric=audience_country&period=lifetime`,
  ];
  for (const base of attempts) {
    try {
      const r = await fetch(base + `&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const j = await r.json();
      const row = (j.data || [])[0];
      if (!row) continue;

      // 신형: total_value.breakdowns[0].results[] = { dimension_values:['KR'], value:n }
      const br = row.total_value && Array.isArray(row.total_value.breakdowns)
        ? row.total_value.breakdowns[0] : null;
      if (br && Array.isArray(br.results)) {
        const out = br.results
          .map((x) => ({
            country_code: String((x.dimension_values || [])[0] || '').toUpperCase(),
            followers: typeof x.value === 'number' ? x.value : null,
          }))
          .filter((x) => x.country_code && x.followers != null);
        if (out.length) return out;
      }

      // 구형: values[0].value = { KR: 1234, US: 567, … }
      const v = row.values && row.values[0] ? row.values[0].value : null;
      if (v && typeof v === 'object') {
        const out = Object.entries(v)
          .map(([cc, n]) => ({ country_code: String(cc).toUpperCase(), followers: typeof n === 'number' ? n : null }))
          .filter((x) => x.country_code && x.followers != null);
        if (out.length) return out;
      }
    } catch (_) { /* 다음 형식으로 */ }
  }
  return [];
}

/** 수집 → 저장. 저장 건수를 돌려준다. */
async function captureSnapshot(opts) {
  const snap = await fetchSnapshot(opts);
  const token = process.env.IG_ACCESS_TOKEN;

  // 게시물별 인사이트(저장·공유·도달)를 4건씩 병렬로 붙인다. best-effort —
  // 인사이트가 실패해도 좋아요·댓글은 그대로 저장된다.
  const posts = Array.isArray(snap.posts) ? snap.posts : [];
  const enriched = [];
  const CONC = 4;
  for (let i = 0; i < posts.length; i += CONC) {
    const batch = posts.slice(i, i + CONC);
    const ins = await Promise.all(batch.map(p =>
      (p && p.id) ? fetchPostInsights(p.id, p.media_type, token) : Promise.resolve({})));
    batch.forEach((p, k) => enriched.push(Object.assign({}, p, ins[k])));
  }
  const rows = toMetricRows(enriched);

  await supabaseAdmin.from('ig_account_snapshot').insert({
    handle: snap.account.handle,
    followers: snap.account.followers,
    media_count: snap.account.media_count,
  });

  // 시계열이라 실행마다 새 행을 넣는다(captured_at 기본값 now()). 예전엔
  // onConflict:'post_id,captured_at' 로 upsert 했는데 그 유니크 제약이 DB 에
  // 없어(일반 인덱스뿐) 매번 42P10 에러 → 게시물 metric 이 통째로 안 쌓였다
  // (계정 스냅샷만 남던 원인, 2026-07-27 수정).
  let stored = 0;
  if (rows.length) {
    const { error } = await supabaseAdmin.from('ig_post_metric').insert(rows);
    if (error) throw error;
    stored = rows.length;
  }

  /* 팔로워 국가 구성 — 하루 1회만 (2026-07-30 신설).
   * 크론은 3시간마다 돌지만 이 지표는 lifetime 누적이라 하루 1행이면 충분하고,
   * 유니크 인덱스(handle, country_code, captured_on)가 중복을 막는다.
   * 실패해도 본 수집(게시물·팔로워)은 이미 끝났으므로 삼킨다 — 부가 지표가
   * 주 지표를 죽이면 안 된다. */
  let audience = 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: seen } = await supabaseAdmin.from('ig_audience_snapshot')
      .select('id').eq('handle', snap.account.handle).eq('captured_on', today).limit(1);
    if (!seen || !seen.length) {
      const list = await fetchAudienceCountries(token, process.env.IG_USER_ID);
      if (list.length) {
        const { error } = await supabaseAdmin.from('ig_audience_snapshot').upsert(
          list.map((x) => ({ handle: snap.account.handle, captured_on: today, ...x })),
          { onConflict: 'handle,country_code,captured_on' });
        if (error) console.warn('[igSnapshot] 국가 구성 저장 실패', error.message);
        else audience = list.length;
      } else {
        console.warn('[igSnapshot] 국가 구성 응답 없음 — API 형식 변경 또는 권한 확인 필요');
      }
    }
  } catch (e) {
    console.warn('[igSnapshot] 국가 구성 수집 실패', e && e.message);
  }

  return { account: snap.account, posts_captured: stored, audience_rows: audience };
}

/* ── 집계 (순수 함수 — 테스트 대상) ───────────────────────────────── */

/**
 * 팔로워 스냅샷 배열 → 일평균 증가.
 * rows: [{ followers, captured_at }] (오름차순·내림차순 무관)
 */
function followerGrowth(rows) {
  const pts = (rows || [])
    .filter(r => typeof r.followers === 'number' && r.captured_at)
    .map(r => ({ f: r.followers, t: Date.parse(r.captured_at) }))
    .filter(p => !isNaN(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const days = (last.t - first.t) / 86400000;
  if (days <= 0) return null;
  return {
    from: first.f,
    to: last.f,
    gained: last.f - first.f,
    days: Math.round(days * 100) / 100,
    per_day: Math.round((last.f - first.f) / days),
  };
}

/**
 * 게시물 24시간 성과 배열 → 주간 평균.
 * rows: [{ posted_at, like_count, comments_count }]
 * 반환: [{ week, posts, avg_likes, avg_comments }] (주 오름차순)
 */
function weeklyEngagement(rows) {
  const buckets = new Map();
  for (const r of rows || []) {
    if (!r.posted_at) continue;
    const d = new Date(r.posted_at);
    if (isNaN(d.getTime())) continue;
    // 주 시작(월요일) 기준 키
    const day = (d.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
    const key = monday.toISOString().slice(0, 10);
    if (!buckets.has(key)) buckets.set(key, { week: key, posts: 0, likes: 0, comments: 0 });
    const b = buckets.get(key);
    b.posts++;
    b.likes += r.like_count || 0;
    b.comments += r.comments_count || 0;
  }
  return [...buckets.values()]
    .map(b => ({
      week: b.week,
      posts: b.posts,
      avg_likes: Math.round(b.likes / b.posts),
      avg_comments: Math.round((b.comments / b.posts) * 10) / 10,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

/** 저장된 데이터로 추세 리포트를 만든다 (읽기 전용). */
async function buildReport(days) {
  const d = Math.max(2, Math.min(120, days || 30));
  const since = new Date(Date.now() - d * 86400000).toISOString();

  const [acct, posts] = await Promise.all([
    supabaseAdmin.from('ig_account_snapshot')
      .select('followers, captured_at').gte('captured_at', since)
      .order('captured_at', { ascending: true }).limit(2000),
    supabaseAdmin.from('ig_post_24h')
      .select('posted_at, like_count, comments_count').gte('posted_at', since)
      .order('posted_at', { ascending: true }).limit(2000),
  ]);

  return {
    window_days: d,
    followers: followerGrowth(acct.data || []),
    weekly_engagement: weeklyEngagement(posts.data || []),
    note: (acct.data || []).length < 2
      ? '스냅샷이 아직 부족합니다 — 최소 2일치가 쌓여야 추세가 나옵니다.'
      : null,
  };
}

module.exports = {
  fetchSnapshot, fetchPostInsights, toMetricRows, captureSnapshot,
  followerGrowth, weeklyEngagement, buildReport,
};
