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

const { withCronGuard } = require('../_lib/cronGuard');   // 실행기록·실패알림 (2026-07-30)
const { runBackfillBatch, normalizeBatch, LANG_NAMES, KINDS } = require('../_lib/seoTranslateBackfill');

/* 함수 상한 120초 중 105초만 쓴다 — 응답 직렬화/네트워크 여유 15초. */
const BUDGET_MS = 105000;
/* 한 언어를 시도하려면 최소 이만큼은 남아 있어야 한다. */
const MIN_PER_LANG_MS = 30000;
/* 언어당 Claude 호출 타임아웃 상한. */
const MAX_CALL_MS = 50000;

module.exports = withCronGuard('backfill-translations', async function handler(req, res) {
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

  /* 2026-07-21 — 아티클 본문 번역 추가.
     ─────────────────────────────────────────────────────────────────
     (lang × kind) 조합을 한 바퀴 돌린다. 한 번 실행에 시간 예산(105초)
     안에서 1~3개 조합만 처리되므로, 매번 같은 순서로 돌면 뒤쪽 조합이
     영원히 굶는다 → 실행마다 시작점을 회전시켜 공정하게 나눈다.

     아티클 배치를 작게 잡는 이유: 본문 번역은 1건에 15~20초가 걸린다
     (운영 실측: batch=5 가 약 85초). 크론 예산 안에 확실히 들어오도록
     2건으로 제한한다. 관리자 수동 실행은 기본값(5)을 그대로 쓴다. */
  const kinds = String(process.env.SEO_TRANSLATE_KINDS || 'editorial,article')
    .split(',').map(s => s.trim().toLowerCase())
    /* KINDS 가 없을 수도 있다(테스트가 모듈을 스텁으로 갈아끼운다).
       그래도 죽지 않게 하고, 최종 검증은 runBackfillBatch 에 맡긴다 —
       거기서 잘못된 kind 는 400 으로 거부된다. */
    .filter(k => !KINDS || !!KINDS[k]);
  const CRON_ARTICLE_BATCH = 2;

  const tasks = [];
  for (const lang of langs) for (const kind of kinds) tasks.push({ lang, kind });
  /* 회전은 기본 동작이지만 테스트에서는 순서가 고정돼야 검증이 가능하다.
     SEO_TRANSLATE_ROTATE=0 이면 정의된 순서를 그대로 쓴다. */
  const rotate = process.env.SEO_TRANSLATE_ROTATE !== '0';
  const offset = (rotate && tasks.length) ? Math.floor(Date.now() / 600000) % tasks.length : 0;
  const ordered = tasks.slice(offset).concat(tasks.slice(0, offset));

  const results = [];
  let totalProcessed = 0;
  let rateLimited = false;

  for (const task of ordered) {
    const { lang, kind } = task;
    if (rateLimited) {
      results.push({ lang, kind, skipped: 'rate-limited-earlier' });
      continue;
    }
    if (left() < MIN_PER_LANG_MS) {
      results.push({ lang, kind, skipped: 'time-budget', leftMs: left() });
      continue;
    }

    const timeoutMs = Math.max(15000, Math.min(MAX_CALL_MS, left() - 10000));
    try {
      const r = await runBackfillBatch({
        lang, kind, timeoutMs,
        batch: kind === 'article' ? CRON_ARTICLE_BATCH : batch,
      });
      totalProcessed += r.processed || 0;
      results.push(r);
    } catch (err) {
      const msg = String((err && err.message) || err);
      // 429 = Anthropic rate limit → 남은 언어는 다음 실행으로 미룬다.
      if (/Claude API 실패 \(429/.test(msg) || /rate.?limit/i.test(msg)) {
        rateLimited = true;
      }
      console.error('[cron/backfill-translations]', kind, lang, msg);
      results.push({ lang, kind, error: msg.slice(0, 300) });
    }
  }

  // 이번 실행에서 실제로 확인된 언어들의 잔량 합계 (건너뛴 언어는 알 수 없음)
  const measured = results.filter(r => typeof r.remaining === 'number');
  const remainingTotal = measured.reduce((a, r) => a + r.remaining, 0);
  const allMeasured = measured.length === ordered.length;

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
}, { silenceTransient: true });
