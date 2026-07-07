/**
 * PAP Magazine — Threads OAuth 콜백
 * Route: GET /api/threads/callback?code=...
 * 코드를 장기 토큰(60일)으로 교환해 threads_auth(단일 행)에 저장.
 * (Meta 앱 콘솔 리디렉션 콜백 URL 에 등록됨.)
 */
const { exchangeCode } = require('../_lib/threads');

module.exports = async function handler(req, res) {
  const code = req.query && req.query.code;
  if (!code) return res.status(400).send('code 누락 — Threads 승인 화면에서 거부되었거나 잘못된 접근');
  try {
    const j = await exchangeCode(code);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<meta charset="utf-8"><body style="font-family:sans-serif;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh">'
      + '<div><h2>✅ Threads 연동 완료</h2><p>user_id: ' + String(j.user_id || '').slice(0, 12)
      + '… (60일 토큰, 크론이 자동 연장)</p><p>이 창은 닫아도 됩니다. 이제 신규 기사가 @pap_magazine 에 자동 게시됩니다.</p></div>'
    );
  } catch (err) {
    console.error('[threads-callback] error:', err);
    return res.status(500).send('토큰 교환 실패: ' + String(err && err.message || err).slice(0, 200));
  }
};
