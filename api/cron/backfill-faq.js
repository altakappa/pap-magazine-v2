/**
 * PAP Magazine — 기사 FAQ 백필 크론 (2026-07-21 신설)
 * Route: /api/cron/backfill-faq   (vercel.json: 10분마다, 완주하면 무해하게 공회전)
 *
 * 왜: 2026-07-21 SEO/GEO 감사 — 발행 기사 484건 중 FAQ 보유 24건(5%).
 * AEO 교육자료 기준 FAQ 는 AI 답변 노출의 핵심 구조인데 사실상 미적용 상태였다.
 * 사람이 관리자 엔드포인트를 수백 번 누르는 방식(다국어 번역 때 실제로 그랬다)을
 * 되풀이하지 않도록 처음부터 크론으로 만든다.
 *
 * 로직은 api/_lib/faqBackfill.js 하나 — 관리자 수동 엔드포인트와 공유한다.
 * 잔여 0이면 Claude 를 호출하지 않으므로 완주 후 크론을 켜둬도 비용이 없다.
 */

const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { runFaqBackfillBatch, normalizeBatch } = require('../_lib/faqBackfill');

module.exports = withCronGuard('backfill-faq', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const batch = normalizeBatch(
    (req.query && req.query.batch) || process.env.FAQ_BACKFILL_BATCH, 10);

  try {
    // 크론 함수 예산 안에서 끝나도록 번역 백필과 같은 타임아웃 방침.
    const out = await runFaqBackfillBatch({ batch, timeoutMs: 90000 });
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 500;
    console.error('[backfill-faq]', (err && err.message) || err);
    return res.status(code).json({ ok: false, error: (err && err.message) || 'failed' });
  }
});
