/**
 * GET /api/auth/google
 * 2026-07-12 — Supabase를 우회하고 Google OAuth로 직접 리다이렉트한다.
 * (기존엔 Supabase /authorize 경유라 동의 화면에 xxx.supabase.co 도메인이 노출됐다.
 *  카카오와 동일한 자체 처리 방식으로 전환해 pap-magazine.com 도메인이 표시되게 함.)
 *
 * 필요 env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (콜백에서 사용)
 * Google Cloud OAuth 클라이언트에 아래 redirect URI들을 등록해야 함:
 *   https://www.pap-magazine.com/api/auth/google-callback
 *   https://pap-magazine.com/api/auth/google-callback
 *   https://www.papkorea.com/api/auth/google-callback
 *   https://papkorea.com/api/auth/google-callback
 *   (m. 서브도메인도 로그인에 쓰면 함께 등록)
 */

const crypto = require('crypto');
const { handleCors } = require('../_lib/cors');

// 사용자가 시작한 호스트를 그대로 유지한다. redirect_uri(인가 요청)와
// 토큰 교환 시 redirect_uri가 정확히 일치해야 하고, state 쿠키도 동일
// 호스트에서 읽어야 하므로 x-forwarded-* 로 원본 오리진을 복원한다.
function getRequestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    if (!GOOGLE_CLIENT_ID) {
      console.error('GOOGLE_CLIENT_ID environment variable is not set');
      return res.status(500).json({ message: 'OAuth configuration error' });
    }

    const origin = getRequestOrigin(req);
    const REDIRECT_URI = `${origin}/api/auth/google-callback`;

    // CSRF state
    const state = crypto.randomBytes(32).toString('base64url');
    res.setHeader('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      include_granted_scopes: 'true',
    });

    return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  } catch (error) {
    console.error('Google OAuth init error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed' });
  }
};
