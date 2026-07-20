/**
 * PAP Magazine — 인스타그램 성과 스냅샷 크론 (2026-07-21 신설)
 * Route: /api/cron/ig-snapshot   (vercel.json: 3시간마다)
 *
 * 왜: 도메니코가 "참여가 줄었다 / 팔로워 증가가 꺾였다"고 할 때 검증할 데이터가
 * 없었다. 좋아요·댓글·팔로워를 아무 데도 저장하지 않아 매번 게시 빈도 같은
 * 간접 증거로 추측해야 했다. 이제 실측치를 남긴다.
 *
 * 3시간 주기인 이유: 게시물 좋아요는 게시 직후 급상승하므로, 시기 간 비교를
 * 하려면 "게시 후 24시간" 같은 동일 나이 시점의 값이 필요하다. 3시간 간격이면
 * 어떤 게시물이든 24시간 ±1.5시간 관측이 확보된다 (뷰 ig_post_24h 가 그걸 고른다).
 *
 * 사용법:
 *   GET /api/cron/ig-snapshot              — 수집·저장 (크론)
 *   GET /api/cron/ig-snapshot?report=1     — 저장된 데이터로 추세 리포트
 *   GET /api/cron/ig-snapshot?report=1&days=14
 */

const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { captureSnapshot, buildReport } = require('../_lib/igSnapshot');

module.exports = withCronGuard('ig-snapshot', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  // 리포트 모드 — 저장된 것만 읽는다 (IG API 미호출).
  if (req.query && req.query.report === '1') {
    const days = parseInt(req.query.days || '', 10) || 30;
    return res.status(200).json({ ok: true, report: await buildReport(days) });
  }

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(503).json({ error: 'IG env 미설정' });
  }

  const limit = Math.max(1, Math.min(50, parseInt((req.query && req.query.limit) || '', 10) || 25));
  const result = await captureSnapshot({ limit });
  return res.status(200).json({ ok: true, ...result });
});
