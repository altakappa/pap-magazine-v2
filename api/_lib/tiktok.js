/**
 * PAP Magazine — TikTok Content Posting API 공유 라이브러리
 *
 * 의존 env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 * 토큰 저장: tiktok_auth 테이블 (066) — refresh 토큰이 회전하므로 env가 아닌 DB.
 *
 * 소비자:
 *   api/tiktok/oauth.js    — 인증 시작 (관리자가 1회 브라우저로 승인)
 *   api/tiktok/callback.js — 코드 교환 → 토큰 저장
 *   api/cron/tiktok-post.js — 데일리 자동 게시 (포토 모드)
 *
 * 주의: 앱이 TikTok 심사(audit)를 통과하기 전에는 privacy_level 이
 * SELF_ONLY(비공개)로 강제된다 — TIKTOK_PUBLIC=1 env 로 심사 후 전환.
 */

const { supabaseAdmin } = require('./supabase');

const AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com/v2';
/* 2026-08-21 — video.list 추가 (도메니코 결정).
 *
 * 왜 필요한가: 인스타 스토리 전용 영상은 웹 기사가 없어서 유튜브 쇼츠에 올릴
 * 제목·설명을 만들 데가 없다. 그런데 같은 영상이 틱톡에는 올라가 있고,
 * 거기엔 **사람이 쓴 캡션**이 있다. 그 캡션을 제목의 원천으로 쓴다
 * (첫 프레임을 AI 로 추측하는 것보다 정확하고, 비용도 안 든다).
 *
 * ⚠️ video.list 는 TIKTOK_SCOPES env 로 켠 뒤 1회 재인증해야 쓸 수 있다.
 *    기존 토큰은 옛 스코프 그대로라 video.list 호출이 401/403 이 난다.
 *    (2026-08-07 drive.readonly · 2026-08-18 webmasters.readonly 때와 같은 모양) */
/* 2026-08-21 두 번째 판단 — 기본값을 되돌리고 env 로 연다.
 *
 * video.list 를 기본 스코프에 넣었더니 인증 화면이 이렇게 죽었다:
 *     문제가 발생했습니다 / non_sandbox_target
 * 7월 17일에는 같은 앱으로 user.info.basic,video.publish 인증이 됐다.
 * 달라진 건 스코프 하나뿐이므로, 이 앱이 video.list 를 아직 쓸 수 없는
 * 상태(샌드박스이거나, 앱에 그 권한이 추가되지 않았거나)라고 본다.
 * — 이건 추정이다. 틱톡 콘솔에서 확인해야 확정된다.
 *
 * 확정 전까지 **기본값은 되던 값**으로 둔다. 이유:
 * 지금 토큰은 리프레시로 살아 있지만, 리프레시가 언젠가 깨져 재인증이
 * 필요해지는 날 기본 스코프가 인증 불가 상태면 **틱톡 게시가 통째로 멈춘다.**
 * 쓰지도 못하는 권한 때문에 되던 것까지 막을 이유가 없다. */

/* ── 2026-08-22 확정 — 추정이 아니라 사실 ─────────────────────
 * 도메니코: "틱톡은 api를 받을수없어서 buffer를 쓰는거야."
 *
 * 위 08-21 주석은 '콘솔에서 확인하면 열릴 수도 있다'는 여지를 남겼다.
 * 그 여지가 없다. **PAP 은 틱톡 프로덕션 API 를 받을 수 없다.**
 * 그래서 게시 경로가 처음부터 버퍼다 (api/cron/drive-tiktok-post.js →
 * _lib/buffer.js → createVideoPost). non_sandbox_target 은 오류가 아니라
 * 그 사실을 그대로 말해 준 것이었다.
 *
 * 따라서:
 *   · TIKTOK_SCOPES 로 video.list 를 켜지 마라. 인증 화면이 죽는다.
 *   · 아래 listMyVideos()/captionOf() 는 **쓰이지 않는다.** 지우지 않는 이유는
 *     지웠다가 누가 같은 길을 다시 파는 것보다, 여기 왜 못 쓰는지 적힌 채로
 *     남아 있는 편이 싸기 때문이다. 새로 부르지 마라.
 *   · 스토리 쇼츠 제목의 원천은 **파일명**이다. 대안이 없어서가 아니라,
 *     사람이 쓴 값이 제일 정확하고 비용이 0 이라서다. */
const SCOPES = process.env.TIKTOK_SCOPES || 'user.info.basic,video.publish';
const REDIRECT_URI = 'https://www.pap-magazine.com/api/tiktok/callback';

function authorizeUrl(state) {
  const p = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: state || 'pap',
  });
  return AUTH_BASE + '?' + p.toString();
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });
  const r = await fetch(API + '/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('token exchange 실패: ' + JSON.stringify(j).slice(0, 200));
  await saveTokens(j);
  return j;
}

async function saveTokens(j) {
  const now = Date.now();
  const { error } = await supabaseAdmin.from('tiktok_auth').upsert({
    id: 1,
    open_id: j.open_id || null,
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: new Date(now + (j.expires_in || 86400) * 1000).toISOString(),
    refresh_expires_at: new Date(now + (j.refresh_expires_in || 31536000) * 1000).toISOString(),
    scope: j.scope || SCOPES,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// 유효한 access_token 반환 — 만료 임박(10분) 시 refresh 후 회전 저장.
async function getAccessToken() {
  const { data: row, error } = await supabaseAdmin.from('tiktok_auth').select('*').eq('id', 1).single();
  if (error || !row || !row.refresh_token) throw new Error('TikTok 미인증 — /api/tiktok/oauth 로 1회 인증 필요');
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() - Date.now() > 600000) {
    return row.access_token;
  }
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
  });
  const r = await fetch(API + '/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('token refresh 실패: ' + JSON.stringify(j).slice(0, 200));
  await saveTokens(j);
  return j.access_token;
}

/**
 * 포토 모드 직접 게시 (PULL_FROM_URL — 이미지 도메인은 TikTok 콘솔에서
 * URL 소유권 인증 필요: pap-magazine.com 프록시 경유).
 * 주의: 포토 게시는 title(≤90자)과 description(캡션·해시태그, ≤4000자)이
 * 분리 필드다 — title에 긴 캡션을 넣으면 invalid_params 로 거부된다.
 * @param {string[]} photoUrls 최대 35장
 * @param {string} title 짧은 제목 (≤90자)
 * @param {string} description 캡션 본문 + 해시태그
 * @returns publish_id
 */
async function directPostPhotos(photoUrls, title, description) {
  const token = await getAccessToken();
  const isPublic = process.env.TIKTOK_PUBLIC === '1';
  const payload = {
    post_info: {
      title: String(title || '').slice(0, 90),
      description: String(description || '').slice(0, 4000),
      privacy_level: isPublic ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY',
      disable_comment: false,
      auto_add_music: true,
    },
    source_info: {
      source: 'PULL_FROM_URL',
      photo_cover_index: 0,
      photo_images: photoUrls.slice(0, 35),
    },
    post_mode: 'DIRECT_POST',
    media_type: 'PHOTO',
  };
  const r = await fetch(API + '/post/publish/content/init/', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!r.ok || (j.error && j.error.code !== 'ok')) {
    throw new Error('photo post 실패: ' + JSON.stringify(j).slice(0, 300));
  }
  return j.data && j.data.publish_id;
}

/**
 * TikTok PULL_FROM_URL 은 URL 소유권이 인증된 도메인만 허용한다
 * (pap-magazine.com 인증됨). S3·Supabase 원본 이미지를 Vercel 이미지
 * 최적화 프록시(자사 도메인)로 감싸 반환 — vercel.json images.remotePatterns
 * 에 두 호스트가 등록돼 있어야 한다.
 */
/**
 * @param {string} u 원본 이미지 URL
 * @param {{logo?: boolean}} [opts] logo:true 면 하단 중앙에 PAP 워드마크 합성
 *   (어드민 인스타 생성기와 동일 규격 — 너비 15%, 하단 여백 1%, 투명도 85%)
 */
function toOwnedImageUrl(u, opts) {
  if (!u) return u;
  const logo = !!(opts && opts.logo);
  // 자사 도메인 URL 은 그대로 통과 — 단, 로고 스탬프가 필요한 정적 이미지는
  // 프록시 경유 (API 경로는 재귀 방지를 위해 항상 원본 유지)
  if (/^https:\/\/www\.pap-magazine\.com\//.test(u) && (!logo || u.indexOf('/api/') !== -1)) return u;
  // /api/img — 1080px JPEG 정규화 중계 (Vercel 이미지 최적화는 AVIF/WebP
  // 협상 때문에 TikTok picture_size_check 에서 실패한다)
  // pad=7 — 틱톡은 캡션·음악 오버레이가 하단을 덮어 1% 여백이면 로고가
  // 잘려 보인다. 하단 여백 7%로 올려 오버레이·크롭 안전지대 확보.
  return 'https://www.pap-magazine.com/api/img?u=' + encodeURIComponent(u) + (logo ? '&logo=1&pad=7' : '');
}

/**
 * 내 틱톡 게시물 목록 (최신순). video.list 스코프가 필요하다.
 *
 * 반환 항목의 `title` 이 틱톡에서 말하는 캡션이다 (본문 문구).
 * `video_description` 도 같이 받아 둔다 — 계정/버전에 따라 어느 쪽에 문구가
 * 들어가는지 다르다는 보고가 있어서, 둘 중 **비어 있지 않은 쪽**을 쓴다.
 * 추측하지 않고 둘 다 받아서 고르는 편이 싸다.
 *
 * @param {{max?:number, cursor?:number}} [opts]
 * @returns {Promise<{videos:Array, cursor:number|null, hasMore:boolean}>}
 */
async function listMyVideos(opts) {
  const o = opts || {};
  const token = await getAccessToken();
  const fields = 'id,title,video_description,create_time,duration,share_url,cover_image_url';
  const body = { max_count: Math.max(1, Math.min(20, o.max || 20)) };
  if (o.cursor) body.cursor = o.cursor;
  const r = await fetch(API + '/video/list/?fields=' + encodeURIComponent(fields), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  const err = j && j.error;
  if (!r.ok || (err && err.code && err.code !== 'ok')) {
    /* 스코프 미승인이 가장 흔한 실패다. 사유를 뭉개지 않고 그대로 올린다 —
       '권한이 없다' 와 '네트워크가 죽었다' 는 대응이 완전히 다르다. */
    throw new Error('video.list 실패 (' + r.status + '): '
      + JSON.stringify(err || j).slice(0, 240));
  }
  const d = (j && j.data) || {};
  return {
    videos: Array.isArray(d.videos) ? d.videos : [],
    cursor: (d.cursor != null) ? d.cursor : null,
    hasMore: !!d.has_more,
  };
}

/** 틱톡 항목에서 사람이 쓴 문구를 뽑는다. title 우선, 없으면 video_description. */
function captionOf(v) {
  const t = String((v && v.title) || '').trim();
  if (t) return t;
  return String((v && v.video_description) || '').trim();
}

module.exports = { authorizeUrl, exchangeCode, getAccessToken, directPostPhotos, toOwnedImageUrl, listMyVideos, captionOf, SCOPES, REDIRECT_URI };
