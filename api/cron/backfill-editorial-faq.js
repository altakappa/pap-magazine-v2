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
const { runEditorialFaqI18nBatch } = require('../_lib/editorialFaqI18nBackfill');
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
    /* ① 원본(ko) 생성 — 이 크론의 본업. 함수 예산의 절반을 준다. */
    const started = Date.now();
    const out = await runEditorialFaqBackfillBatch({ batch, timeoutMs: 55000 });

    /* ② 남은 시간에 언어판 소급을 이어서 돈다 (2026-08-27, 도메니코 "최근분만").
       왜 별도 크론이 아닌가: 크론 호출 예산 가드(vercel-cost-guard)가 하루 총
       호출 상한을 지킨다 — 새 크론을 등록하면 그 상한을 넘긴다. 같은 호출 안에서
       이어 돌면 호출 수 증가가 0이다. 실패해도 ①의 결과는 그대로 보고한다. */
    let i18n = null;
    const left = 100000 - (Date.now() - started);
    if (left > 25000) {
      try {
        /* 6 → 18 (2026-09-02). 6 은 "응답이 잘리면 배치 전멸" 이라는 전제로 고른
           값인데, JSONL 로 바꾼 뒤로는 잘려도 완성된 줄이 다 살아남는다.
           MAX_TOKENS 도 16,000 으로 올려 상한이 배치를 묶지 않는다. */
        /* 18 → 8 (2026-09-02, 라이브 실측 후 되돌림). 18 로 키운 콜이 95초 안에
           안 끝났다 — 런타임 로그 'aborted due to timeout' 16건, 429 는 0건.
           batch 6 이 약 30초였으니 8 은 40초 안쪽이고 콜 상한 55초에 든다.
           처리량은 배치가 아니라 파도(회전)로 올린다. */
        i18n = await runEditorialFaqI18nBatch({ batch: 8, timeoutMs: left });
      } catch (e2) {
        console.error('[backfill-editorial-faq] i18n:', (e2 && e2.message) || e2);
        i18n = { processed: 0, note: '언어판 실패' };
      }
    }

    /* 요약 한 줄이 곧 생산량 기록 — 'ok'는 함수가 안 죽었다는 뜻이지 일을 했다는
       뜻이 아니다 (기사 FAQ 크론의 2026-08-04 교훈 그대로). */
    res.locals.cronNote = (out.note || ('화보FAQ ' + (out.processed || 0) + ' · 잔여 '
      + (out.remaining == null ? '?' : out.remaining)))
      + (i18n ? ' | ' + i18n.note : '');
    return res.status(200).json({ ok: true, ...out, i18n });
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 500;
    console.error('[backfill-editorial-faq]', (err && err.message) || err);
    res.locals.cronNote = '화보FAQ 실패 — ' + String((err && err.message) || 'failed').slice(0, 120);
    return res.status(code).json({ ok: false, error: (err && err.message) || 'failed' });
  }
});
