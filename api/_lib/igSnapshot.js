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
    };
  });
}

/** 수집 → 저장. 저장 건수를 돌려준다. */
async function captureSnapshot(opts) {
  const snap = await fetchSnapshot(opts);
  const rows = toMetricRows(snap.posts);

  await supabaseAdmin.from('ig_account_snapshot').insert({
    handle: snap.account.handle,
    followers: snap.account.followers,
    media_count: snap.account.media_count,
  });

  // 같은 시(hour)에 이미 넣었으면 유니크 인덱스가 막는다 — 크론 재시도 방어.
  let stored = 0;
  if (rows.length) {
    const { error } = await supabaseAdmin.from('ig_post_metric')
      .upsert(rows, { onConflict: 'post_id,captured_at', ignoreDuplicates: true });
    if (error && !/duplicate|unique/i.test(error.message || '')) throw error;
    stored = rows.length;
  }
  return { account: snap.account, posts_captured: stored };
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
  fetchSnapshot, toMetricRows, captureSnapshot,
  followerGrowth, weeklyEngagement, buildReport,
};
