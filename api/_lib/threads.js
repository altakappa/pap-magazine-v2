/**
 * PAP Magazine — Threads API 공유 라이브러리 (@pap_magazine)
 *
 * 의존 env: THREADS_APP_ID, THREADS_APP_SECRET
 * 토큰 저장: threads_auth 테이블 (071) — 장기 토큰 60일, 만료 임박 시 자동 연장.
 *
 * 소비자:
 *   api/threads/oauth.js    — 인증 시작 (관리자 1회, @pap_magazine 로그인 상태)
 *   api/threads/callback.js — 코드 교환 → 장기 토큰 저장
 *   api/cron/threads-post.js — 신규 기사 자동 게시 (TEXT + 링크 프리뷰)
 *
 * 앱은 개발 모드 + @pap_magazine 이 Threads 테스터 — 본 계정 게시는 심사 없이
 * 즉시 실사용 가능 (테스터 계정의 게시물은 실제 공개 게시물이다).
 */

const { supabaseAdmin } = require('./supabase');

const AUTH_BASE = 'https://threads.net/oauth/authorize';
const GRAPH = 'https://graph.threads.net';
const SCOPES = 'threads_basic,threads_content_publish';
const REDIRECT_URI = 'https://www.pap-magazine.com/api/threads/callback';

function authorizeUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_type: 'code',
    state: state || 'pap',
  });
  return AUTH_BASE + '?' + p.toString();
}

// 코드 → 단기 토큰 → 장기 토큰(60일) 교환 후 저장
async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID,
    client_secret: process.env.THREADS_APP_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });
  const r = await fetch(GRAPH + '/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('token exchange 실패: ' + JSON.stringify(j).slice(0, 200));

  const lr = await fetch(GRAPH + '/access_token?grant_type=th_exchange_token&client_secret='
    + encodeURIComponent(process.env.THREADS_APP_SECRET) + '&access_token=' + encodeURIComponent(j.access_token), {
    signal: AbortSignal.timeout(15000),
  });
  const lj = await lr.json();
  if (!lr.ok || lj.error) throw new Error('장기 토큰 교환 실패: ' + JSON.stringify(lj).slice(0, 200));

  await saveToken({ user_id: String(j.user_id || ''), access_token: lj.access_token, expires_in: lj.expires_in });
  return { user_id: j.user_id, expires_in: lj.expires_in };
}

async function saveToken(t) {
  const patch = {
    id: 1,
    access_token: t.access_token,
    expires_at: new Date(Date.now() + (t.expires_in || 5184000) * 1000).toISOString(),
    scope: SCOPES,
    updated_at: new Date().toISOString(),
  };
  if (t.user_id) patch.user_id = t.user_id;
  const { error } = await supabaseAdmin.from('threads_auth').upsert(patch);
  if (error) throw error;
}

// 유효 토큰 반환 — 만료 7일 전부터 th_refresh_token 으로 60일 연장
async function getAccessToken() {
  const { data: row, error } = await supabaseAdmin.from('threads_auth').select('*').eq('id', 1).single();
  if (error || !row || !row.access_token) throw new Error('Threads 미인증 — /api/threads/oauth 로 1회 인증 필요');
  const msLeft = new Date(row.expires_at || 0).getTime() - Date.now();
  if (msLeft > 7 * 86400000) return { token: row.access_token, userId: row.user_id };
  const r = await fetch(GRAPH + '/refresh_access_token?grant_type=th_refresh_token&access_token='
    + encodeURIComponent(row.access_token), { signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (!r.ok || j.error) {
    // 연장 실패 — 남은 기간 내면 기존 토큰으로 계속, 완전 만료면 재인증 요구
    if (msLeft > 0) return { token: row.access_token, userId: row.user_id };
    throw new Error('token refresh 실패 (만료) — /api/threads/oauth 재인증 필요: ' + JSON.stringify(j).slice(0, 150));
  }
  await saveToken({ access_token: j.access_token, expires_in: j.expires_in });
  return { token: j.access_token, userId: row.user_id };
}

/**
 * TEXT 스레드 게시 (본문 내 첫 URL이 링크 프리뷰 카드가 된다).
 * 2단계: 컨테이너 생성 → 게시.
 *
 * 엔드포인트: `/v1.0/me/threads` — 저장된 user_id 로 요청하면 Threads API 가
 * Instagram user ID 를 Threads user ID 로 오인하여 code 100 subcode 33
 * ('Object does not exist / missing permissions') 반환한다. `me` 사용 시
 * 토큰 소유자로 자동 매핑되어 안전.
 *
 * @param {string} text ≤500자
 * @returns {Promise<string>} thread id
 */
async function postText(text) {
  const { token } = await getAccessToken();
  const create = await fetch(GRAPH + '/v1.0/me/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ media_type: 'TEXT', text: String(text || '').slice(0, 500), access_token: token }),
    signal: AbortSignal.timeout(20000),
  });
  const cj = await create.json();
  if (!create.ok || !cj.id) throw new Error('컨테이너 생성 실패: ' + JSON.stringify(cj).slice(0, 300));
  // 2026-07-23 — 생성 직후 즉시 발행하면 컨테이너 처리(텍스트에 링크가
  // 있으면 미리보기 페치 포함)가 안 끝난 상태라 "Media Not Found"(code 24)
  // 가 난다 (제니 기사 무한 재시도 사고 실측). Meta 권고대로 상태를
  // 폴링해 FINISHED 확인 후 발행하고, ERROR 면 사유를 그대로 표면화한다.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 3000 : 4000));
    const st = await fetch(GRAPH + '/v1.0/' + cj.id + '?fields=status,error_message&access_token=' + encodeURIComponent(token), {
      signal: AbortSignal.timeout(10000),
    });
    const sj = await st.json().catch(() => ({}));
    if (sj.status === 'FINISHED') break;
    if (sj.status === 'ERROR') throw new Error('컨테이너 처리 실패: ' + (sj.error_message || JSON.stringify(sj).slice(0, 200)));
    if (i === 5) throw new Error('컨테이너 처리 대기 초과 (status=' + (sj.status || '?') + ')');
  }
  const pub = await fetch(GRAPH + '/v1.0/me/threads_publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: cj.id, access_token: token }),
    signal: AbortSignal.timeout(20000),
  });
  const pj = await pub.json();
  if (!pub.ok || !pj.id) throw new Error('게시 실패: ' + JSON.stringify(pj).slice(0, 300));
  return pj.id;
}

module.exports = { authorizeUrl, exchangeCode, getAccessToken, postText, REDIRECT_URI };
