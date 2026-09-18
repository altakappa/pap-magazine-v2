/**
 * PAP Magazine — 유튜브 공식 채널 최신 업로드 조회 (2026-09-18 신설)
 *
 * 왜 유튜브인가 (도메니코 "케이팝 아이돌 정보를 빠르게 알 수 있는 곳"):
 * 컴백은 대부분 **티저 영상이 먼저** 뜬다. 인스타 게시물보다 빠르거나 동시다.
 * 그리고 이미 다 깔려 있다 — YOUTUBE_API_KEY 가 환경변수에 있고
 * youtube-sync 크론이 같은 API 를 쓴다. 새 계정도 결제도 필요 없다.
 *
 * 비용: playlistItems.list 는 1 유닛이다. 무료 할당량이 하루 10,000 이므로
 * 채널 20개를 20분마다 봐도 1,440 유닛이다. 여유가 크다.
 * (channels.list 로 핸들을 푸는 건 채널당 딱 한 번만 하고 DB 에 캐시한다.)
 *
 * ── 왜 채널 ID 를 사람이 안 넣나 ─────────────────────────────────────
 * UC 로 시작하는 24자 문자열은 사람이 보고 맞는지 알 수 없다. 오타가 나도
 * 그냥 '결과 없음' 이라 조용히 지나간다. 대신 사람이 읽을 수 있는 핸들
 * (@BTS)을 넣게 하고, **API 가 직접 풀어서** 채널 ID 와 실제 채널명을
 * DB 에 적는다. 인스타 쪽 api_name 과 같은 원리다 —
 * '읽혔다' 가 아니라 '누구인지' 를 남겨야 사람이 훑고 거른다.
 *
 * 반환 모양은 igDiscovery.discoverAccount 와 **일부러 똑같이** 맞춘다.
 * 감시 크론이 플랫폼마다 다른 모양을 다루면 규칙이 두 벌이 된다.
 */
'use strict';

const YT_API = 'https://www.googleapis.com/youtube/v3';

/** 채널 ID(UC…) → 업로드 재생목록 ID(UU…). 조회 한 번을 아낀다. */
function uploadsPlaylistOf(channelId) {
  const s = String(channelId || '');
  return /^UC[\w-]{20,}$/.test(s) ? 'UU' + s.slice(2) : null;
}

/** 핸들(@BTS) 또는 채널 ID 로 채널을 찾는다. 1 유닛. */
async function resolveChannel(handleOrId) {
  if (!process.env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY 미설정');
  const raw = String(handleOrId || '').trim();
  if (!raw) throw new Error('채널 식별자가 비었다');

  const params = new URLSearchParams({ part: 'snippet', key: process.env.YOUTUBE_API_KEY });
  if (/^UC[\w-]{20,}$/.test(raw)) params.set('id', raw);
  else params.set('forHandle', raw.startsWith('@') ? raw : '@' + raw);

  const r = await fetch(YT_API + '/channels?' + params.toString(),
    { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error('channels.list 실패 ' + r.status + ': '
      + String((j.error && j.error.message) || '').slice(0, 120));
  }
  const item = (j.items || [])[0];
  /* 핸들이 틀리면 items 가 빈 배열로 온다 — 에러가 아니다.
     그냥 넘기면 '읽혔는데 아무것도 없다' 로 보여 영원히 조용하다. 던진다. */
  if (!item) throw new Error('채널을 찾지 못했다: ' + raw);
  return { channelId: item.id, name: (item.snippet && item.snippet.title) || null };
}

/**
 * 채널의 최신 업로드를 가져온다.
 * @param {{ extId?: string, handle: string, limit?: number }} opts
 * @returns {{ channelId, name, media: Array }} media 원소는 igDiscovery 와 같은 모양
 */
async function discoverChannel(opts) {
  if (!process.env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY 미설정');
  const limit = Math.max(1, Math.min(20, (opts && opts.limit) || 5));

  /* ext_id 가 캐시돼 있으면 channels.list 를 건너뛴다 (유닛 절약). */
  let channelId = (opts && opts.extId) || null;
  let name = null;
  if (!uploadsPlaylistOf(channelId)) {
    const resolved = await resolveChannel(opts && opts.handle);
    channelId = resolved.channelId;
    name = resolved.name;
  }
  const playlist = uploadsPlaylistOf(channelId);
  if (!playlist) throw new Error('업로드 재생목록을 만들 수 없다: ' + channelId);

  const p = new URLSearchParams({
    part: 'snippet', playlistId: playlist,
    maxResults: String(limit), key: process.env.YOUTUBE_API_KEY,
  });
  const r = await fetch(YT_API + '/playlistItems?' + p.toString(),
    { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error('playlistItems.list 실패 ' + r.status + ': '
      + String((j.error && j.error.message) || '').slice(0, 120));
  }

  const media = (j.items || []).map((it) => {
    const sn = it.snippet || {};
    const vid = (sn.resourceId && sn.resourceId.videoId) || null;
    if (!vid) return null;
    /* 제목이 뉴스 판정의 핵심 신호다 ("[MV]", "Official Teaser", "Comeback Trailer").
       설명문은 링크·해시태그 범벅이라 앞부분만 붙인다. 합쳐 200자 —
       인스타 caption_head 와 같은 길이로 맞춰 판정기 입력을 통일한다. */
    const desc = String(sn.description || '').replace(/\s+/g, ' ').trim();
    const caption = (String(sn.title || '').trim() + (desc ? ' — ' + desc : '')).slice(0, 200);
    return {
      type: 'VIDEO',
      likes: null,      // videos.list 를 또 부르면 유닛이 2배다. 판정에 필수가 아니다.
      comments: null,
      ts: sn.publishedAt || null,
      permalink: 'https://www.youtube.com/watch?v=' + vid,
      caption_head: caption,
      shortcode: vid,   // 유튜브는 영상 ID 가 곧 shortcode 다
    };
  }).filter(Boolean);

  return { channelId, name, media };
}

module.exports = { discoverChannel, resolveChannel, uploadsPlaylistOf };
