/**
 * PAP Magazine — YouTube Data API v3 공유 라이브러리
 *
 * 의존 env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET
 * 토큰 저장: youtube_auth 테이블 (070) — tiktok.js 와 동일 패턴.
 *
 * 소비자:
 *   api/youtube/oauth.js     — 인증 시작 (관리자가 1회 브라우저로 승인)
 *   api/youtube/callback.js  — 코드 교환 → 토큰 저장
 *   api/cron/youtube-post.js — 기사 릴스 mp4 → Shorts 자동 업로드
 *
 * OAuth 앱은 Google Workspace '내부' 앱 (pap-magazine.com 조직 전용) —
 * Google 인증 심사 불필요, 토큰 7일 만료 없음.
 *
 * 주의: 미감사(unaudited) API 프로젝트의 업로드가 비공개로 잠길 수 있어
 * (2020-07 정책) 첫 업로드로 실측 확인 — 공개 정상이면 YOUTUBE_PUBLIC=1.
 */

const { supabaseAdmin } = require('./supabase');

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
// 2026-08-07 drive.readonly 추가 — 구글 드라이브 '유튜브' 폴더의 mp4 를 읽어
// 쇼츠로 올린다(인스타 릴스 mp4 회수가 8/3부터 69% 실패해 영구 대안이 필요했다).
// ⚠️ 스코프를 늘렸으므로 /api/youtube/oauth 로 **1회 재인증**해야 실제로 적용된다.
//    기존 refresh_token 은 옛 스코프만 갖고 있어 드라이브 호출이 403 난다.
// 2026-08-07 youtube.readonly 추가 — 우리가 올린 영상이 살아 있는지 서버가
// 스스로 확인하기 위해서다. 그날 영상 하나가 사라진 것을 사람이 눈으로
// 발견했다(중복 업로드분을 지운 것이었지만, 저작권 삭제였어도 똑같이 몰랐다).
// 올려놓고 상태를 못 묻는 건 오늘 하루 종일 잡은 침묵과 같은 모양이다.
// 2026-08-18 webmasters.readonly 추가 — Search Console 을 우리 DB 로 가져온다.
// 왜 여기에 붙이나: 구글 OAuth 앱이 이미 하나 있고, 앱을 또 만들면 도메니코가
// 인증을 두 번 해야 한다. 스코프는 읽기 전용이라 기존 권한을 넓히지 않는다.
// ⚠️ 스코프를 늘렸으므로 /api/youtube/oauth 로 **1회 재인증**해야 적용된다.
//    2026-08-07 drive.readonly 때와 같다 — 옛 refresh_token 은 403 난다.
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload'
  + ' https://www.googleapis.com/auth/youtube.readonly'
  + ' https://www.googleapis.com/auth/drive.readonly'
  + ' https://www.googleapis.com/auth/webmasters.readonly';
const REDIRECT_URI = 'https://www.pap-magazine.com/api/youtube/callback';

function authorizeUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',   // refresh_token 발급
    prompt: 'consent',        // 재승인 시에도 refresh_token 재발급 보장
    state: state || 'pap',
  });
  return AUTH_BASE + '?' + p.toString();
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });
  const r = await fetch(TOKEN_URL, {
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
  // Google 은 refresh 시 refresh_token 을 다시 주지 않는다 — 기존 값 보존.
  const patch = {
    id: 1,
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
    scope: j.scope || SCOPES,
    updated_at: new Date().toISOString(),
  };
  if (j.refresh_token) patch.refresh_token = j.refresh_token;
  const { error } = await supabaseAdmin.from('youtube_auth').upsert(patch);
  if (error) throw error;
}

// 유효한 access_token 반환 — 만료 임박(5분) 시 refresh.
async function getAccessToken() {
  const { data: row, error } = await supabaseAdmin.from('youtube_auth').select('*').eq('id', 1).single();
  if (error || !row || !row.refresh_token) throw new Error('YouTube 미인증 — /api/youtube/oauth 로 1회 인증 필요');
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() - Date.now() > 300000) {
    return row.access_token;
  }
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
  });
  const r = await fetch(TOKEN_URL, {
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

// YouTube 제목은 <, > 금지 + 100자 한도. 개행도 제거.
function sanitizeTitle(t) {
  return String(t || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/**
 * Shorts 업로드 (resumable, 단일 PUT).
 * Vercel 함수 메모리(1GB)·시간(120s) 내에서 IG 릴스(≤60MB)는 안전.
 * @param {Buffer} buffer mp4 바이트
 * @param {{title:string, description:string, tags?:string[], privacyStatus:'public'|'private'|'unlisted'}} meta
 * @returns {Promise<{id:string, status:object}>} video id + status
 */
async function uploadVideo(buffer, meta) {
  const token = await getAccessToken();
  const snippet = {
    title: sanitizeTitle(meta.title),
    description: String(meta.description || '').slice(0, 4900),
    tags: (meta.tags || []).slice(0, 15),
    categoryId: '24', // Entertainment
    defaultLanguage: 'ko',
  };
  const status = {
    privacyStatus: meta.privacyStatus || 'private',
    selfDeclaredMadeForKids: false,
  };
  // 1) 업로드 세션 시작
  const init = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(buffer.length),
    },
    body: JSON.stringify({ snippet, status }),
    signal: AbortSignal.timeout(20000),
  });
  if (!init.ok) throw new Error('upload init 실패 ' + init.status + ': ' + (await init.text()).slice(0, 300));
  const location = init.headers.get('location');
  if (!location) throw new Error('upload init: Location 헤더 없음');
  // 2) 바이트 전송 (단일 요청 — 60MB 이하라 청크 불필요)
  const put = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buffer.length) },
    body: buffer,
    signal: AbortSignal.timeout(100000),
  });
  const j = await put.json().catch(() => ({}));
  if (!put.ok || !j.id) throw new Error('upload 실패 ' + put.status + ': ' + JSON.stringify(j).slice(0, 300));
  return j;
}

/**
 * 올린 영상들의 현재 상태를 묻는다 (youtube.readonly 필요).
 * 응답에 없는 id = 삭제됐거나 접근 불가.
 *
 * part 에 contentDetails 가 반드시 있어야 한다. 2026-08-07 사고:
 * eBKJKbk4SjE 는 privacyStatus='public', uploadStatus='processed',
 * rejectionReason=null 이라 status 만 보던 감시기 눈에는 멀쩡했다.
 * 실제로는 regionRestriction.blocked 가 249개국 — 사실상 전 세계 차단이었다.
 * Content ID 소유권 주장은 영상을 '거절'하지 않는다. 그대로 두고 '막는다'.
 * 그래서 status 만으로는 영원히 못 본다.
 *
 * @param {string[]} ids 최대 50개씩 나눠 보낸다
 * @returns {Promise<Map<string,{privacyStatus,uploadStatus,rejectionReason,failureReason,blockedRegions,licensedContent}>>}
 */
async function fetchVideoStates(ids) {
  const out = new Map();
  const list = (ids || []).filter(Boolean);
  if (!list.length) return out;
  const token = await getAccessToken();
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const url = 'https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails&id=' + chunk.join(',');
    const r = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 403) {
      throw new Error('videos.list 권한 없음 — YouTube OAuth 에 youtube.readonly 가 없습니다. /api/youtube/oauth 로 1회 재승인하세요.');
    }
    if (!r.ok) throw new Error('videos.list 실패 ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
    const j = await r.json();
    for (const v of (j.items || [])) {
      const rr = (v.contentDetails && v.contentDetails.regionRestriction) || {};
      out.set(v.id, {
        privacyStatus: v.status && v.status.privacyStatus,
        uploadStatus: v.status && v.status.uploadStatus,
        rejectionReason: v.status && v.status.rejectionReason,
        failureReason: v.status && v.status.failureReason,
        blockedRegions: Array.isArray(rr.blocked) ? rr.blocked.length : 0,
        licensedContent: !!(v.contentDetails && v.contentDetails.licensedContent),
      });
    }
  }
  return out;
}

module.exports = {
  fetchVideoStates, authorizeUrl, exchangeCode, getAccessToken, uploadVideo, REDIRECT_URI };
