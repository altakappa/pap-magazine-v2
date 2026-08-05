/**
 * PAP Magazine — Threads OAuth 시작 (관리자 1회)
 * Route: GET /api/threads/oauth[?account=2|?brand=pepperit]
 * 인증하려는 계정으로 로그인된 브라우저에서 열기 → Threads 승인 화면.
 * 승인 후 /api/threads/callback 으로 돌아와 장기 토큰이 DB(threads_auth)에 저장된다.
 *
 * 2026-08-05 — 계정이 둘이 됐다 (1=@pap_magazine, 2=@pepperitmag).
 * 콜백 URL 은 늘리지 않는다. 도메인을 하나 더 만들면 Meta 앱 콘솔의 리디렉션
 * URL 목록까지 같이 바꿔야 하고 그건 저장소 밖의 설정이다. 대신 어느 계정을
 * 인증하는 중인지를 OAuth state 에 실어 보내고 콜백이 그걸 되읽는다.
 *
 * 인자를 안 주면 예전과 똑같이 PAP(1) 이다 — 기존 북마크가 그대로 동작한다.
 */
const { authorizeUrl, buildState, normalizeAccountId } = require('../_lib/threads');

/* ?brand=pepperit 처럼 사람이 읽는 값도 받는다. 이 링크는 도메니코가 손으로
   여는 자리라, 계정 번호를 외우게 하는 것보다 이름을 받는 편이 안전하다. */
const BRAND_ACCOUNT = { pap: 1, pepperit: 2 };

module.exports = async function handler(req, res) {
  if (!process.env.THREADS_APP_ID) return res.status(503).json({ error: 'THREADS_APP_ID 미설정' });
  const q = req.query || {};
  const brand = String(q.brand || '').toLowerCase();
  const accountId = normalizeAccountId(BRAND_ACCOUNT[brand] || q.account);
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, authorizeUrl(buildState(accountId), accountId));
};
