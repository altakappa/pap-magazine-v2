/**
 * PAP Magazine — Threads OAuth 콜백
 * Route: GET /api/threads/callback?code=...&state=acct2.<ts>
 * 코드를 장기 토큰(60일)으로 교환해 threads_auth 의 해당 계정 행에 저장.
 * (Meta 앱 콘솔 리디렉션 콜백 URL 에 등록됨 — 계정이 늘어도 이 URL 은 하나다.)
 *
 * 2026-08-05 — 어느 계정을 인증했는지는 state 로만 안다. 콜백 도메인을 계정별로
 * 나누지 않기로 했기 때문이다(api/_lib/threads.js 머리말 참조). state 가 없거나
 * 옛 형식('pap-<ts>')이면 1(PAP)로 떨어진다 — 기존 동작 그대로다.
 */
const { exchangeCode, accountIdFromState, accountInfo } = require('../_lib/threads');

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const code = q.code;
  if (!code) return res.status(400).send('code 누락 — Threads 승인 화면에서 거부되었거나 잘못된 접근');
  const accountId = accountIdFromState(q.state);
  const info = accountInfo(accountId);
  try {
    const j = await exchangeCode(code, accountId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<meta charset="utf-8"><body style="font-family:sans-serif;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh">'
      + '<div><h2>✅ Threads 연동 완료 (' + info.handle + ')</h2><p>user_id: ' + String(j.user_id || '').slice(0, 12)
      + '… (60일 토큰, 크론이 자동 연장)</p><p>이 창은 닫아도 됩니다. 이제 ' + info.handle + ' 자동 게시가 동작합니다.</p></div>'
    );
  } catch (err) {
    console.error('[threads-callback] error:', err);
    return res.status(500).send('토큰 교환 실패: ' + String(err && err.message || err).slice(0, 200));
  }
};
