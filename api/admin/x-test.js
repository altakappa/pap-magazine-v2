/**
 * GET /api/admin/x-test — X 자동 게시 연결 검증 (관리자 전용)
 * 키 + 크레딧 상태를 실제 트윗 1건으로 확인한다.
 *   ?text=<내용>        (기본: 연결 확인 문구 + 웹사이트 링크)
 *   ?brand=pepperit     (@pepperitmag 계정으로 테스트)
 */

const { requireAdmin } = require('../_lib/auth');
const { postTweet, postPepperitTweet, isConfigured, isPepperitConfigured } = require('../_lib/xPost');

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  if (req.query && req.query.brand === 'pepperit') {
    if (!isPepperitConfigured()) return res.status(503).json({ error: 'X_PEPPERIT env 미설정' });
    const text = req.query.text ||
      'PEPPERIT — 케이팝 · 패션 · 뷰티 · 컬쳐 데일리 매거진\n\nhttps://www.pepperitmag.com\n\n#KPOP #PEPPERIT';
    const r = await postPepperitTweet(String(text));
    return res.status(r.ok ? 200 : 502).json(r);
  }

  if (!isConfigured()) return res.status(503).json({ error: 'X env 4개 미설정' });
  const text = (req.query && req.query.text) ||
    'PAP MAGAZINE — 아트 기반 패션·뷰티·컬쳐 매거진\n\nhttps://www.pap-magazine.com\n\n#PAPMAGAZINE #FASHION';
  const r = await postTweet(String(text));
  return res.status(r.ok ? 200 : 502).json(r);
};
