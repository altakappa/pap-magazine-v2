/**
 * PAP Magazine — 다국어 SEO 번역 백필 크론
 * Route: /api/cron/backfill-translations  (vercel.json crons 에 등록, 10분 주기)
 *
 * 왜 만들었나 (2026-07-21):
 *   그동안 잔량(it/fr/es 약 2,700건)을 예약 작업이 브라우저로 한 번에 20건씩
 *   손으로 호출해 소진해왔다 — 회당 45~120건, 완주까지 30회 이상 필요한 속도였다.
 *   서버가 알아서 돌면 될 일을 사람이 클릭하고 있었던 것. 10분 주기 × 3언어 ×
 *   20건 = 시간당 약 360건 → 잔량 2,700건이면 하루 안에 완주한다.
 *
 * 완주 후에도 끌 필요 없다: 잔량이 0이면 Claude 호출 없이 즉시 반환하고(no-op),
 * 새 에디토리얼이 발행되면 10분 안에 자동으로 it/fr/es 번역이 붙는다.
 *
 * 시간 예산:
 *   Vercel 함수 상한은 120초(vercel.json). 3개 언어가 이 예산을 나눠 쓴다.
 *   매 언어 시작 전 남은 예산을 확인하고, 부족하면 그 언어는 건너뛴다
 *   (skipped 로 보고 → 다음 10분 실행에서 처리). 함수가 타임아웃으로 강제
 *   종료되면 응답 로그가 안 남아 무슨 일이 있었는지 알 수 없기 때문.
 *
 * 안전 설계:
 *   - upsert 기반이라 중복 실행·중복 저장 안전
 *   - 429(rate limit) 만나면 남은 언어까지 즉시 중단, 다음 실행에 재개
 *   - 한 언어가 실패해도 나머지 언어는 계속 진행 (429 제외)
 *   - 처리 로직은 api/_lib/seoTranslateBackfill.js 로 관리자 엔드포인트와 공용
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY       : 필수 (없으면 503)
 *   CRON_SECRET             : (선택) Vercel cron 보호 — 다른 크론과 동일 규약
 *   SEO_TRANSLATE_BATCH     : (선택) 언어당 실행 배치 크기, 기본 20 (상한 20)
 *   SEO_TRANSLATE_LANGS     : (선택) 대상 언어 CSV, 기본 "it,fr,es"
 */

const { runBackfillBatch, normalizeBatch, LANG_NAMES } = require('../_lib/seoTranslateBackfill');

/* 함수 상한 120초 중 105초만 쓴다 — 응답 직렬화/네트워크 여유 15초. */
const BUDGET_MS = 105000;
/* 한 언어를 시도하려면 최소 이만큼은 남아 있어야 한다. */
const MIN_PER_LANG_MS = 30000;
/* 언어당 Claude 호출 타임아웃 상한. */
const MAX_CALL_MS = 50000;

module.exports = async function handler(req, res) {
  // Vercel cron 보호 (다른 크론과 동일 규약)
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY 환경변수 미설정.' });
  }

  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const left = () => BUDGET_MS - elapsed();

  const langs = String(process.env.SEO_TRANSLATE_LANGS || 'it,fr,es')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => LANG_NAMES[s]);

  const batch = normalizeBatch(process.env.SEO_TRANSLATE_BATCH, 20);

  const results = [];
  let totalProcessed = 0;
  let rateLimited = false;

  for (const lang of langs) {
    if (rateLimited) {
      results.push({ lang, skipped: 'rate-limited-earlier' });
      continue;
    }
    if (left() < MIN_PER_LANG_MS) {
      results.push({ lang, skipped: 'time-budget', leftMs: left() });
      continue;
    }

    const timeoutMs = Math.max(15000, Math.min(MAX_CALL_MS, left() - 10000));
    try {
      const r = await runBackfillBatch({ lang, batch, timeoutMs });
      totalProcessed += r.processed || 0;
      results.push(r);
    } catch (err) {
      const msg = String((err && err.message) || err);
      // 429 = Anthropic rate limit → 남은 언어는 다음 실행으로 미룬다.
      if (/Claude API 실패 \(429/.test(msg) || /rate.?limit/i.test(msg)) {
        rateLimited = true;
      }
      console.error('[cron/backfill-translations]', lang, msg);
      results.push({ lang, error: msg.slice(0, 300) });
    }
  }

  // 이번 실행에서 실제로 확인된 언어들의 잔량 합계 (건너뛴 언어는 알 수 없음)
  const measured = results.filter(r => typeof r.remaining === 'number');
  const remainingTotal = measured.reduce((a, r) => a + r.remaining, 0);
  const allMeasured = measured.length === langs.length;

  return res.status(200).json({
    ok: true,
    batch,
    langs,
    processed: totalProcessed,
    remainingTotal: allMeasured ? remainingTotal : undefined,
    allDone: allMeasured && remainingTotal === 0 ? true : undefined,
    rateLimited: rateLimited || undefined,
    elapsedMs: elapsed(),
    results,
  });
};
