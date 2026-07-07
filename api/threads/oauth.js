/**
 * PAP Magazine — Threads OAuth 시작 (관리자 1회)
 * Route: GET /api/threads/oauth
 * @pap_magazine 으로 로그인된 브라우저에서 열기 → Threads 승인 화면.
 * 승인 후 /api/threads/callback 으로 돌아와 장기 토큰이 DB(threads_auth)에 저장된다.
 */
const { authorizeUrl } = require('../_lib/threads');

module.exports = async function handler(req, res) {
  if (!process.env.THREADS_APP_ID) return res.status(503).json({ error: 'THREADS_APP_ID 미설정' });
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, authorizeUrl('pap-' + Date.now()));
};
