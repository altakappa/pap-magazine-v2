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
const SCOPES = 'user.info.basic,video.publish';
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
  return 'https://www.pap-magazine.com/api/img?u=' + encodeURIComponent(u) + (logo ? '&logo=1' : '');
}

module.exports = { authorizeUrl, exchangeCode, getAccessToken, directPostPhotos, toOwnedImageUrl, REDIRECT_URI };
