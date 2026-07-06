/**
 * GET /api/admin/x-pepperit-auth — @pepperitmag X 계정 토큰 발급 (관리자 전용)
 *
 * PAP 앱(X_API_KEY/SECRET)을 재사용해 3-legged OAuth(PIN 방식)로
 * @pepperitmag 사용자 토큰을 발급한다. 별도 개발자 계정·과금 불필요.
 *
 * 사용 순서:
 *   1) ?step=start
 *      → { authorizeUrl, oauth_token, oauth_token_secret } 반환.
 *        @pepperitmag 으로 로그인된 브라우저에서 authorizeUrl 접속 → 앱 승인
 *        → 화면에 PIN(숫자) 표시.
 *   2) ?step=finish&oauth_token=...&oauth_token_secret=...&pin=1234567
 *      → { oauth_token, oauth_token_secret, screen_name } 반환.
 *        이 두 값을 Vercel 환경변수로 저장:
 *          X_PEPPERIT_ACCESS_TOKEN / X_PEPPERIT_ACCESS_TOKEN_SECRET
 */

const { requireAdmin } = require('../_lib/auth');
const { requestToken, accessToken } = require('../_lib/xPost');

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (!process.env.X_API_KEY || !process.env.X_API_SECRET) {
    return res.status(503).json({ error: 'X_API_KEY / X_API_SECRET 미설정' });
  }

  const q = req.query || {};
  try {
    if (q.step === 'start') {
      const t = await requestToken();
      return res.status(200).json({
        authorizeUrl: t.authorizeUrl,
        oauth_token: t.oauth_token,
        oauth_token_secret: t.oauth_token_secret,
        next: '@pepperitmag 으로 로그인한 브라우저에서 authorizeUrl 접속 → 승인 → PIN 확인 후 ?step=finish 호출',
      });
    }
    if (q.step === 'finish') {
      if (!q.oauth_token || !q.oauth_token_secret || !q.pin) {
        return res.status(400).json({ error: 'oauth_token, oauth_token_secret, pin 필요' });
      }
      const t = await accessToken(q.oauth_token, q.oauth_token_secret, q.pin);
      return res.status(200).json({
        screen_name: t.screen_name,
        X_PEPPERIT_ACCESS_TOKEN: t.oauth_token,
        X_PEPPERIT_ACCESS_TOKEN_SECRET: t.oauth_token_secret,
        next: '위 두 값을 Vercel 환경변수(Production)로 추가 후 재배포',
      });
    }
    return res.status(400).json({ error: '?step=start 또는 ?step=finish' });
  } catch (e) {
    return res.status(502).json({ error: String(e && e.message || e).slice(0, 300) });
  }
};
