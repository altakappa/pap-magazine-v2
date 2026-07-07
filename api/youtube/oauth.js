/**
 * PAP Magazine — YouTube OAuth 시작 (관리자 1회)
 * Route: GET /api/youtube/oauth  (관리자 브라우저에서 열기 → Google 승인 화면)
 * contact@pap-magazine.com 으로 로그인해 PAP 유튜브 채널 소유 계정으로 승인.
 * 승인 후 /api/youtube/callback 으로 돌아와 토큰이 DB(youtube_auth)에 저장된다.
 */
const { authorizeUrl } = require('../_lib/youtube');

module.exports = async function handler(req, res) {
  if (!process.env.YOUTUBE_CLIENT_ID) return res.status(503).json({ error: 'YOUTUBE_CLIENT_ID 미설정' });
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, authorizeUrl('pap-' + Date.now()));
};
