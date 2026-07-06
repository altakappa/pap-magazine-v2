/**
 * PAP Magazine — TikTok OAuth 콜백
 * Route: GET /api/tiktok/callback?code=...
 * 코드를 토큰으로 교환해 tiktok_auth(단일 행)에 저장.
 * (TikTok 앱 콘솔의 Redirect URI 에 이 주소를 등록해야 함:
 *  https://www.pap-magazine.com/api/tiktok/callback)
 */
const { exchangeCode } = require('../_lib/tiktok');

module.exports = async function handler(req, res) {
  const code = req.query && req.query.code;
  if (!code) return res.status(400).send('code 누락 — TikTok 승인 화면에서 거부되었거나 잘못된 접근');
  try {
    const j = await exchangeCode(code);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<meta charset="utf-8"><body style="font-family:sans-serif;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh">'
      + '<div><h2>✅ TikTok 연동 완료</h2><p>open_id: ' + String(j.open_id || '').slice(0, 12)
      + '… / scope: ' + String(j.scope || '') + '</p><p>이 창은 닫아도 됩니다. 이제 자동 게시 크론이 이 계정으로 게시합니다.</p></div>'
    );
  } catch (err) {
    console.error('[tiktok-callback] error:', err);
    return res.status(500).send('토큰 교환 실패: ' + String(err && err.message || err).slice(0, 200));
  }
};
