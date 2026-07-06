/**
 * GET /api/admin/x-test — X 자동 게시 연결 검증 (관리자 전용)
 * 키 4개 + 크레딧 상태를 실제 트윗 1건으로 확인한다.
 *   ?text=<내용>  (기본: 연결 확인 문구 + 웹사이트 링크)
 */

const { requireAdmin } = require('../_lib/auth');
const { postTweet, isConfigured } = require('../_lib/xPost');

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (!isConfigured()) return res.status(503).json({ error: 'X env 4개 미설정' });

  const text = (req.query && req.query.text) ||
    'PAP MAGAZINE — 아트 기반 패션·뷰티·컬쳐 매거진\n\nhttps://www.pap-magazine.com\n\n#PAPMAGAZINE #FASHION';
  const r = await postTweet(String(text));
  return res.status(r.ok ? 200 : 502).json(r);
};
