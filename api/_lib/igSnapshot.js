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

/* 전환 지표 — 게시물이 팔로워를 데려왔는지 말해주는 **유일한 직접 지표**다.
   도달·좋아요·저장은 전부 대리지표다(도달 1.6M 인데 팔로우 170 인 게시물이
   실제로 있었다 — 2026-07-29). 그래서 따로 이름을 붙여 둔다. */
const CONVERSION_METRICS = ['profile_visits', 'follows'];
const BASE_METRICS = ['reach', 'saved', 'shares', 'total_interactions'];

/* ── 시청유지 지표 (2026-08-17 신설) ───────────────────────────────
 *
 * 도메니코: "클릭율·시청유지·인게이지먼트·반복재생을 업계 최고치로."
 * 그 말을 듣고 지금 무엇을 재고 있는지부터 봤더니, **시청유지를 한 번도
 * 수집한 적이 없었다.** 릴스 30편의 참여율 지표(저장·공유·좋아요·댓글)와
 * 도달의 상관은 전부 |r| < 0.12 다. 즉 지금 가진 숫자로는 릴스가 왜 뜨고
 * 왜 죽는지 설명이 안 된다. 설명이 안 되는 이유가 '릴스는 원래 그렇다'
 * 인지 '우리가 정작 중요한 걸 안 재고 있다' 인지 가릴 방법이 없었다.
 * 릴스 추천의 1차 신호는 시청유지인데 그게 데이터에 없다.
 *
 * 반복재생은 API 로 못 받는다. clips_replays_count 와
 * ig_reels_aggregated_all_plays_count 는 2025-04 에 폐기됐다. 대신
 * **조회/도달**이 대리지표가 된다(계정당 평균 재생 횟수). PAP 실측 30편:
 * 평균 1.43 · 중앙 1.45 · 범위 0.38~1.81. 이건 이미 있는 두 컬럼으로
 * 계산되므로 수집이 따로 필요 없다.
 *
 * ★ 절대 기존 계단에 넣지 않는다.
 *   이 파일이 이미 비싸게 배운 규칙이다: 세트에 지원 안 되는 지표가 하나라도
 *   있으면 응답 **전체**가 400 이다. plays 하나 때문에 릴스가 shares 까지
 *   잃었었다. 그래서 시청유지는 전환 지표와 똑같이 **따로 한 번 더** 묻는다.
 *   실패해도 기존 수집은 한 글자도 안 변한다.
 *
 * 이름이 살아 있는지 확신이 없으므로 계단으로 좁힌다. 둘 다 → 하나씩.
 * 어느 이름이 유효한지 데이터가 스스로 답하게 만든다. */
const WATCH_METRICS = ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'];

/** 시청유지 요청 계단. 순수 함수 — 테스트가 직접 검증한다. */
function watchLadder() {
  return [
    WATCH_METRICS,
    ['ig_reels_avg_watch_time'],
    ['ig_reels_video_view_total_time'],
  ];
}

/** media_type 별 인사이트 요청 계단. 순수 함수 — 테스트가 직접 검증한다. */
function insightLadder(mediaType) {
  const mt = String(mediaType || '').toUpperCase();
  const isVideo = (mt === 'VIDEO' || mt === 'REELS');
  return [
    isVideo ? [...BASE_METRICS, 'views', ...CONVERSION_METRICS] : [...BASE_METRICS, ...CONVERSION_METRICS],
    isVideo ? [...BASE_METRICS, 'views'] : [...BASE_METRICS],
    isVideo ? ['reach', 'saved', 'views'] : ['reach', 'saved'],
    ['reach', 'saved'],
  ];
}

/** 인사이트 1세트 요청. 성공하면 {지표:숫자}, 실패하면 null.
 *  null 과 {} 를 구분하는 게 중요하다 — {} 는 "요청은 됐는데 값이 없다" 다. */
async function fetchInsightSet(mediaId, metrics, token) {
  try {
    const url = `${GRAPH}/${encodeURIComponent(mediaId)}/insights`
      + `?metric=${metrics.join(',')}&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const j = await r.json();
    const out = {};
    for (const m of (j.data || [])) {
      const v = m && m.values && m.values[0] ? m.values[0].value : undefined;
      if (typeof v === 'number') out[m.name] = v;
    }
    // 구 API 는 plays, 신 API 는 views. 둘 중 오는 쪽을 views 로 통일한다.
    if (typeof out.plays === 'number' && typeof out.views !== 'number') out.views = out.plays;
    return out;
  } catch (_) {
    return null;   // 타임아웃·네트워크 — 호출자가 다음 칸으로 넘어간다
  }
}

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
  const ladder = insightLadder(mt);
  let out = null;
  for (const metrics of ladder) {
    out = await fetchInsightSet(mediaId, metrics, token);
    if (out) break;
  }
  if (!out) return { __conv: 'none' };

  /* ── 2026-08-16 — 계단이 통째로 떨어지면서 전환 지표를 늘 잃고 있었다 ──
   *
   * 실측(30일): 영상 49편 **전부** follows·profile_visits 가 NULL 이다(49/49).
   * 캐러셀은 165편 중 20편만 NULL. 영상이 만든 도달이 1,020,469 (전체의 17%)
   * 인데, 릴스가 팔로워를 데려오는지 아닌지를 **한 건도 모른다.**
   * 같은 기간 팔로워는 +5,243 인데 게시물로 설명되는 건 1,906(36%)뿐이다.
   *
   * 원인은 계단 구조다. 세트에 하나라도 지원 안 되는 지표가 있으면 응답 전체가
   * 400 이라 통째로 다음 칸으로 떨어지는데, 전환 지표는 **첫 칸에만** 있다.
   * 그래서 영상은 늘 둘째 칸(전환 없음)에 안착했다. shares 가 30/49 만 모인
   * 것도 같은 이유다(19편은 셋째 칸까지 떨어졌다).
   *
   * → 전환 지표만 따로 한 번 더 묻는다. 이러면 둘 중 하나가 **확정**된다:
   *     · 값이 온다      → 우리가 못 받고 있었을 뿐. 그날부터 보인다.
   *     · 또 실패한다    → 인스타가 릴스에 안 주는 것. **영구 사각지대로 알고** 판단한다.
   *   지금은 이 둘조차 구분이 안 된다. 어느 쪽이든 추측이 사라진다.
   *
   * 비용: 전환 지표가 빠진 건에 대해서만 1콜 추가. 3시간마다 최대 25건이므로
   * 하루 200콜 미만이다. 아래 __conv 집계가 여러 번 돌아도 계속 'unsupported'
   * 뿐이면 그때 이 재시도를 꺼라 — 답이 나온 뒤에는 낭비다. */
  if (out.follows === undefined && out.profile_visits === undefined) {
    const conv = await fetchInsightSet(mediaId, CONVERSION_METRICS, token);
    if (conv && (conv.follows !== undefined || conv.profile_visits !== undefined)) {
      Object.assign(out, conv);
      out.__conv = 'retry';        // 따로 물으니 왔다 — 계단이 문제였다
    } else {
      out.__conv = 'unsupported';  // 따로 물어도 안 온다 — API 가 안 준다
    }
  } else {
    out.__conv = 'ladder';         // 첫 칸에서 정상 수집
  }

  /* 시청유지 — 영상에만, 그리고 반드시 별도 호출로. (2026-08-17)
     비용: 영상 1편당 최대 3콜. 3시간마다 최대 25건 중 영상은 소수다.
     __watch 가 계속 unsupported 뿐이면 이 블록을 꺼라 — 그때부터는 낭비다. */
  if (mt === 'VIDEO' || mt === 'REELS') {
    out.__watch = 'unsupported';
    for (const metrics of watchLadder()) {
      const w = await fetchInsightSet(mediaId, metrics, token);
      const got = w && (typeof w.ig_reels_avg_watch_time === 'number'
                     || typeof w.ig_reels_video_view_total_time === 'number');
      if (got) {
        if (typeof w.ig_reels_avg_watch_time === 'number') out.avg_watch_time_ms = w.ig_reels_avg_watch_time;
        if (typeof w.ig_reels_video_view_total_time === 'number') out.total_watch_time_ms = w.ig_reels_video_view_total_time;
        out.__watch = (out.avg_watch_time_ms !== undefined && out.total_watch_time_ms !== undefined)
          ? 'full' : 'partial';
        break;
      }
    }
  } else {
    out.__watch = 'skip';          // 영상이 아니다 — 애초에 물을 값이 없다
  }

  return {
    saved: out.saved, shares: out.shares, reach: out.reach,
    views: out.views, total_interactions: out.total_interactions,
    profile_visits: out.profile_visits, follows: out.follows,
    avg_watch_time_ms: out.avg_watch_time_ms,
    total_watch_time_ms: out.total_watch_time_ms,
    __conv: out.__conv, __watch: out.__watch,
  };
}

/** 전환 지표를 어디서 얻었는지 세어 준다. 순수 함수 — 테스트가 직접 검증한다.
 *  ladder      첫 칸에서 정상 수집
 *  retry       계단에선 잃었는데 따로 물으니 왔다 → 계단이 문제였다
 *  unsupported 따로 물어도 안 온다 → API 가 안 준다 (영구 사각지대)
 *  none        인사이트 자체가 실패 (권한·삭제·타임아웃) */
function conversionCoverage(posts) {
  const c = { ladder: 0, retry: 0, unsupported: 0, none: 0 };
  for (const p of (posts || [])) {
    const k = p && p.__conv;
    if (k && Object.prototype.hasOwnProperty.call(c, k)) c[k]++;
  }
  return c;
}

/** 시청유지를 얼마나 받았는지 세어 준다. 순수 함수 — 테스트 대상.
 *  full        평균·총 시청시간 둘 다 받음
 *  partial     둘 중 하나만 받음 (지표 이름 하나가 폐기됐다는 뜻)
 *  unsupported 영상인데 셋 다 실패 → 인스타가 안 준다
 *  skip        영상이 아니다 (분모에서 빼야 한다)
 *  전환 지표와 달리 'skip' 이 대다수다. 캐러셀이 게시물의 3/4 이기 때문에
 *  skip 을 실패로 세면 커버리지가 늘 처참해 보이고, 그러면 아무도 안 본다. */
function watchCoverage(posts) {
  const c = { full: 0, partial: 0, unsupported: 0, skip: 0 };
  for (const p of (posts || [])) {
    const k = p && p.__watch;
    if (k && Object.prototype.hasOwnProperty.call(c, k)) c[k]++;
  }
  return c;
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
      // 2026-08-17 — 릴스 시청유지. 밀리초 그대로 저장한다(단위 변환은 읽는 쪽에서).
      avg_watch_time_ms: numOrNull(p.avg_watch_time_ms),
      total_watch_time_ms: numOrNull(p.total_watch_time_ms),
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

  /* 2026-08-16 — 전환 지표를 어디서 얻었는지 집계한다. 조용한 사각지대를
     만들지 않기 위해서다: 영상 49편이 전부 NULL 인 걸 한 달 동안 아무도
     몰랐다. 로그에 한 줄 남으면 다음 실행부터는 눈에 띈다.
     ⚠️ 여러 번 돌려도 계속 unsupported 뿐이면 → 인스타가 릴스에 안 주는 것이
     확정이다. 그때는 위 재시도를 꺼라(그때부터는 순수한 낭비다). */
  const conv = conversionCoverage(enriched);
  console.log('[igSnapshot] 전환지표 수집 — 계단 ' + conv.ladder
    + ' · 재시도로 회수 ' + conv.retry
    + ' · 미지원 ' + conv.unsupported
    + ' · 인사이트 실패 ' + conv.none
    + (conv.unsupported && !conv.retry ? '  ← 미지원만 나온다면 API 가 안 주는 것' : ''));

  /* 2026-08-17 — 시청유지도 같은 방식으로 눈에 보이게 남긴다.
     여기가 조용하면 "안 되는 건지 안 하는 건지" 를 또 한 달 모른다. */
  const watch = watchCoverage(enriched);
  console.log('[igSnapshot] 시청유지 수집 — 완전 ' + watch.full
    + ' · 일부 ' + watch.partial
    + ' · 미지원 ' + watch.unsupported
    + ' · 영상아님 ' + watch.skip
    + (watch.unsupported && !watch.full && !watch.partial
        ? '  ← 영상에서 하나도 못 받았다. 지표 이름이 폐기됐을 수 있다' : ''));

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
  // 2026-08-16 — 계단·전환 집계는 순수 함수라 테스트가 동작을 직접 본다
  insightLadder, conversionCoverage, CONVERSION_METRICS, BASE_METRICS,
  // 2026-08-17 — 시청유지 수집. 계단·집계 모두 순수 함수라 테스트가 직접 본다
  watchLadder, watchCoverage, WATCH_METRICS,
};
