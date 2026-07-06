/**
 * PAP Magazine — TikTok OAuth 시작 (관리자 1회)
 * Route: GET /api/tiktok/oauth  (관리자 브라우저에서 열기 → TikTok 승인 화면)
 * 승인 후 /api/tiktok/callback 으로 돌아와 토큰이 DB(tiktok_auth)에 저장된다.
 */
const { authorizeUrl } = require('../_lib/tiktok');

module.exports = async function handler(req, res) {
  if (!process.env.TIKTOK_CLIENT_KEY) return res.status(503).json({ error: 'TIKTOK_CLIENT_KEY 미설정' });
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, authorizeUrl('pap-' + Date.now()));
};
