/**
 * PAP Magazine — Buffer API (GraphQL) 공유 라이브러리
 *
 * 왜 Buffer 인가 (2026-08-07):
 *   TikTok 앱 심사가 2026-07-10 '거절'됐다. 사유는 서류 미비가 아니라 정책이다 —
 *   "TikTok for Developers currently does not support personal or internal company use."
 *   즉 재신청해도 video.publish 스코프는 영구히 못 받는다. 자체 DIRECT_POST 경로는
 *   사망 확정. Buffer 는 TikTok 공식 파트너라 자기 앱 권한으로 대신 게시해 준다.
 *
 * 의존 env:
 *   BUFFER_API_KEY            (필수) publish.buffer.com/settings/api 에서 발급.
 *                             2027-08-07 만료 — 갱신 안 하면 조용히 멈춘다.
 *   BUFFER_ORG_ID             (선택) 미설정 시 account 쿼리로 자동 탐색.
 *   BUFFER_TIKTOK_CHANNEL_ID  (선택) 미설정 시 channels 쿼리로 자동 탐색.
 *
 * 엔드포인트: POST https://api.buffer.com  (GraphQL 단일 엔드포인트)
 * 인증: Authorization: Bearer <BUFFER_API_KEY>
 *
 * 무료 플랜 제약 (2026-08-07 실측):
 *   채널 3개 · 채널당 예약 대기 10건 · 3,000 req/30일 · 250/24h · 100/15분
 *   → 예약(addToQueue)을 쌓으면 10건 상한에 막힌다. 우리는 크론이 이미 발행
 *     시각을 정하므로 mode='shareNow'(즉시 게시)를 쓴다. 큐를 안 쓰니 상한 무관.
 *
 * 미디어: Buffer 는 파일 업로드를 받지 않는다. 공개 HTTPS 직링크만 받는다.
 *   → api/_lib/tiktok.js 의 toOwnedImageUrl() 이 만드는
 *     https://www.pap-magazine.com/api/img?u=... 를 그대로 쓴다 (공개·직링크·안정).
 */

const API = 'https://api.buffer.com';

// 워밍된 람다 안에서만 유효한 캐시 (조직/채널 ID는 거의 안 변한다).
const CACHE_MS = 10 * 60 * 1000;
const _cache = { orgId: null, orgAt: 0, channels: null, chAt: 0 };

function apiKey() {
  const k = process.env.BUFFER_API_KEY;
  if (!k) throw new Error('BUFFER_API_KEY 미설정 — Vercel 환경변수 확인');
  return k;
}

/** Buffer GraphQL 호출. 성공 시 data 반환, 실패는 전부 throw. */
async function graphql(query, variables, timeoutMs) {
  const r = await fetch(API, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    signal: AbortSignal.timeout(timeoutMs || 20000),
  });
  let j = null;
  try { j = await r.json(); } catch (_) { /* 아래에서 HTTP 코드로 처리 */ }
  if (r.status === 401 || r.status === 403) {
    throw new Error('Buffer 인증 실패 (HTTP ' + r.status + ') — API 키 만료/오타 의심');
  }
  if (r.status === 429) {
    throw new Error('Buffer 레이트리밋 (429) — 잠시 후 재시도');
  }
  if (!r.ok) {
    throw new Error('Buffer HTTP ' + r.status + ': ' + JSON.stringify(j || {}).slice(0, 300));
  }
  if (j && j.errors && j.errors.length) {
    throw new Error('Buffer GraphQL 오류: ' + JSON.stringify(j.errors).slice(0, 300));
  }
  if (!j || !j.data) throw new Error('Buffer 응답에 data 없음');
  return j.data;
}

async function getOrganizationId() {
  if (process.env.BUFFER_ORG_ID) return process.env.BUFFER_ORG_ID;
  if (_cache.orgId && Date.now() - _cache.orgAt < CACHE_MS) return _cache.orgId;
  const d = await graphql('query { account { organizations { id name } } }');
  const orgs = (d.account && d.account.organizations) || [];
  if (!orgs.length) throw new Error('Buffer 조직 없음 — 계정 상태 확인');
  _cache.orgId = orgs[0].id;
  _cache.orgAt = Date.now();
  return _cache.orgId;
}

async function listChannels() {
  if (_cache.channels && Date.now() - _cache.chAt < CACHE_MS) return _cache.channels;
  const organizationId = await getOrganizationId();
  const d = await graphql(
    'query Channels($input: ChannelsInput!) { channels(input: $input) { id name service descriptor } }',
    { input: { organizationId } }
  );
  _cache.channels = d.channels || [];
  _cache.chAt = Date.now();
  return _cache.channels;
}

/**
 * service 이름으로 채널 ID 찾기.
 * Service enum 의 대소문자 표기가 문서마다 흔들려('TikTok' vs 'tiktok')
 * 대소문자·기호 무시 비교 + descriptor 폴백으로 방어한다.
 */
function _norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function findChannelId(service) {
  const want = _norm(service);
  if (want === 'tiktok' && process.env.BUFFER_TIKTOK_CHANNEL_ID) {
    return process.env.BUFFER_TIKTOK_CHANNEL_ID;
  }
  const chans = await listChannels();
  const hit = chans.find((c) => _norm(c.service) === want)
    || chans.find((c) => _norm(c.descriptor).indexOf(want) !== -1);
  if (!hit) {
    const have = chans.map((c) => c.service).join(', ') || '(없음)';
    throw new Error('Buffer 에 ' + service + ' 채널 미연결 — 현재 연결: ' + have);
  }
  return hit.id;
}

const CREATE_POST = [
  'mutation CreatePost($input: CreatePostInput!) {',
  '  createPost(input: $input) {',
  '    __typename',
  '    ... on PostActionSuccess { post { id status dueAt } }',
  '    ... on VoidMutationError { message }',
  '    ... on RestProxyError { message code }',
  '  }',
  '}',
].join('\n');

/**
 * 이미지(포토 캐러셀) 게시.
 * @param {object} o
 * @param {string} o.channelId
 * @param {string} o.text        캡션 본문 + 해시태그
 * @param {string[]} o.imageUrls 공개 HTTPS 직링크 (최대 maxImages 장)
 * @param {string} [o.title]     TikTok 포토 게시 제목 (≤90자)
 * @param {string} [o.mode]      shareNow | addToQueue | shareNext | customScheduled
 * @param {string} [o.dueAt]     customScheduled 일 때 ISO8601 UTC
 * @param {number} [o.maxImages] 기본 10 (TikTok 캐러셀 상한)
 * @param {number} [o.maxText]   기본 2200 (TikTok 캡션 상한)
 * @returns {Promise<{id:string,status:string,dueAt:string|null}>}
 */
async function createImagePost(o) {
  const opts = o || {};
  if (!opts.channelId) throw new Error('channelId 없음');
  const maxImages = opts.maxImages || 10;
  const assets = (opts.imageUrls || [])
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, maxImages)
    .map((url) => ({ image: { url } }));
  if (!assets.length) throw new Error('게시할 이미지 URL 없음');

  const input = {
    channelId: opts.channelId,
    text: String(opts.text || '').slice(0, opts.maxText || 2200),
    assets,
    mode: opts.mode || 'shareNow',
    // automatic = Buffer 가 대신 게시. notification 은 폰 알림만 오고 손으로 올려야 한다.
    schedulingType: 'automatic',
  };
  if (opts.dueAt) input.dueAt = opts.dueAt;
  if (opts.title) input.metadata = { tiktok: { title: String(opts.title).slice(0, 90) } };

  const d = await graphql(CREATE_POST, { input }, 45000);
  const r = d.createPost;
  if (!r) throw new Error('createPost 응답 비어 있음');
  if (r.__typename !== 'PostActionSuccess') {
    throw new Error('Buffer 게시 거부(' + r.__typename + '): ' + String(r.message || '').slice(0, 300));
  }
  return r.post;
}

/** 크론에서 "키가 아예 없다"를 예외 대신 조용한 스킵으로 다루기 위한 헬퍼. */
function isConfigured() { return !!process.env.BUFFER_API_KEY; }

module.exports = {
  graphql,
  getOrganizationId,
  listChannels,
  findChannelId,
  createImagePost,
  isConfigured,
  _norm,
};
