/**
 * PAP Magazine — 화보 FAQ 백필 크론 (2026-08-27 신설)
 * Route: /api/cron/backfill-editorial-faq   (vercel.json: 10분마다, 완주 후 무해 공회전)
 *
 * 기사 FAQ 크론(backfill-faq.js)과 같은 뼈대 — 로직은 editorialFaqBackfill.js 하나.
 * 대상: 발행 화보 2,303편 중 설명문 보유 2,291편 (2026-08-27 기준, faq 0에서 시작).
 */

const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { runEditorialFaqBackfillBatch } = require('../_lib/editorialFaqBackfill');
const { normalizeBatch } = require('../_lib/faqBackfill');

module.exports = withCronGuard('backfill-editorial-faq', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const batch = normalizeBatch(
    (req.query && req.query.batch) || process.env.FAQ_BACKFILL_BATCH, 10);

  try {
    const out = await runEditorialFaqBackfillBatch({ batch, timeoutMs: 90000 });
    /* 요약 한 줄이 곧 생산량 기록 — 'ok'는 함수가 안 죽었다는 뜻이지 일을 했다는
       뜻이 아니다 (기사 FAQ 크론의 2026-08-04 교훈 그대로). */
    res.locals.cronNote = out.note || ('화보FAQ ' + (out.processed || 0) + ' · 잔여 '
      + (out.remaining == null ? '?' : out.remaining));
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 500;
    console.error('[backfill-editorial-faq]', (err && err.message) || err);
    res.locals.cronNote = '화보FAQ 실패 — ' + String((err && err.message) || 'failed').slice(0, 120);
    return res.status(code).json({ ok: false, error: (err && err.message) || 'failed' });
  }
});
