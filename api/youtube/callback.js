/**
 * PAP Magazine — YouTube OAuth 콜백
 * Route: GET /api/youtube/callback?code=...
 * 코드를 토큰으로 교환해 youtube_auth(단일 행)에 저장.
 * (Google Cloud 콘솔 OAuth 클라이언트의 승인된 리디렉션 URI 에 등록됨:
 *  https://www.pap-magazine.com/api/youtube/callback)
 */
const { exchangeCode } = require('../_lib/youtube');

module.exports = async function handler(req, res) {
  const code = req.query && req.query.code;
  if (!code) return res.status(400).send('code 누락 — Google 승인 화면에서 거부되었거나 잘못된 접근');
  try {
    const j = await exchangeCode(code);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<meta charset="utf-8"><body style="font-family:sans-serif;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh">'
      + '<div><h2>✅ YouTube 연동 완료</h2><p>scope: ' + String(j.scope || '')
      + '</p><p>refresh_token ' + (j.refresh_token ? '저장됨' : '기존 값 유지')
      + ' — 이 창은 닫아도 됩니다. 이제 자동 업로드 크론이 이 채널로 게시합니다.</p></div>'
    );
  } catch (err) {
    console.error('[youtube-callback] error:', err);
    return res.status(500).send('토큰 교환 실패: ' + String(err && err.message || err).slice(0, 200));
  }
};
