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
 *   SEO_TRANSLATE_LANGS     : (선택) 대상 언어 CSV, 기본 "it,fr,es,ja"
 */

const { withCronGuard } = require('../_lib/cronGuard');   // 실행기록·실패알림 (2026-07-30)
const { runBackfillBatch, normalizeBatch, LANG_NAMES, KINDS } = require('../_lib/seoTranslateBackfill');

/* 시간 예산 (2026-07-30 105s → 75s 하향).
 *
 * 왜 낮추나 — 실측이 이상했다. 같은 10분 주기인데:
 *     backfill-meta-desc (예산 80s) → 24시간 133/144 회 완주
 *     backfill-translations (예산 105s) → 24시간 **23/144** 회
 * cronGuard 는 실행이 끝날 때 기록하므로, 기록이 없다는 건 함수가 120초
 * 상한에 걸려 죽었다는 뜻이다(로그도 못 남긴다). 예산 105s + 응답 직렬화 +
 * 배치 20건 순차 upsert 가 겹치면 상한을 넘긴다.
 *
 * 실행당 처리량을 줄이더라도 **완주하는 실행 수**를 늘리는 쪽이 총량이 크다.
 * 105s × 23회 = 2,415s 대비, 75s × (완주율 개선) 쪽이 낫다는 판단. */
const BUDGET_MS = 75000;
/* 한 조합을 시도하려면 최소 이만큼은 남아 있어야 한다. */
const MIN_PER_LANG_MS = 25000;
/* 조합당 Claude 호출 타임아웃 상한. 예산을 낮췄으니 함께 낮춘다. */
const MAX_CALL_MS = 35000;

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

  /* 2026-07-30 — 기본 언어에 ja 추가 (도메니코 요청: it·es·fr·ja 우선).
   *
   * 이게 빠져 있어서 일본어는 2,450행 중 189건만 채워져 있었다. 코드가
   * 손댈 생각조차 하지 않는 언어였는데, 사이트는 9개 언어를 표방하고
   * hreflang·사이트맵도 ja 를 내보내고 있었다 — 껍데기만 있고 내용이 없는 상태.
   *
   * 2026-07-31 — 선택기의 9개 언어 전부로 확대 (도메니코: "모든 화보의 언어도
   * 정리"). 그동안 de·ru·zh 를 뺀 이유는 "조합이 늘면 예산을 나눠 쓴다" 였지만,
   * 위에서 조합을 병렬로 돌리게 바꿔 그 전제가 사라졌다. 실제로 de 3% · ru 1% ·
   * zh 0.5% 인 채로 사이트는 9개 언어를 표방하고 hreflang 을 내보내는 중이다.
   *
   * ⚠️ 환경변수 SEO_TRANSLATE_LANGS 가 설정돼 있으면 이 기본값은 무시된다.
   * 실제로 그것 때문에 코드가 선언한 언어와 돌아가는 언어가 달랐고, 로그가
   * 없어 아무도 몰랐다 — env 를 지워 코드를 단일 출처로 두는 편이 안전하다. */
  const langs = String(process.env.SEO_TRANSLATE_LANGS || 'it,fr,es,ja,de,ru,zh')
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
  /* 에디토리얼 배치 — 크론에서는 20 이 아니라 8 이다 (2026-07-31).
   *
   * 왜: 조합당 Claude 호출 타임아웃은 MAX_CALL_MS(35초)로 잘려 있다. 그런데
   * 배치 20건은 그 안에 못 끝난다. 타임아웃이 나면 이미 번역된 응답까지
   * 통째로 버려지고 0건이 저장된다 — 실패가 아니라 '아무 일도 없었음'으로
   * 보였다. 실측: 12시간 31회 실행 전부 ok, es/fr/ja 에디토리얼 저장 0건
   * (es 는 7/24, ja 는 7/22 이후 한 건도 안 늘었다). 같은 예산에서
   * 아티클(배치 2)만 꾸준히 처리되고 있던 이유가 이것이다.
   *
   * 배치를 줄이면 실행당 처리량은 줄지만 **버려지지 않는다.** 20건 × 0회보다
   * 8건 × 매회가 크다. 관리자 수동 실행은 시간 제약이 없어 기본값(20)을 쓴다. */
  const CRON_EDITORIAL_BATCH = normalizeBatch(process.env.SEO_TRANSLATE_EDITORIAL_BATCH, 8);

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

  /* 조합을 CONCURRENCY 개씩 동시에 돌린다 (2026-07-31).
   *
   * 왜: 병목은 토큰이 아니라 **벽시계 시간**이다. 조합 하나가 Claude 응답을
   * 기다리는 25~35초 동안 함수는 그냥 놀고 있었고, 그래서 75초 예산에
   * 2~3개 조합밖에 못 돌렸다. 9개 언어로 늘리면 한 조합이 차례를 받는 데
   * 몇 시간이 걸린다 — de·ru·zh 가 3개월째 1% 인 이유가 이것이다.
   * 서로 다른 (lang,kind) 는 다른 행을 건드리므로 동시에 돌아도 충돌하지 않는다.
   * 백필 서술문 크론에서 같은 방식으로 처리량이 두 배가 됐다.
   *
   * 3 으로 잡은 이유: Anthropic 동시 요청 한도에 여유를 두기 위해서다.
   * 429 가 나면 기존대로 남은 조합을 다음 실행으로 미룬다. */
  const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.SEO_TRANSLATE_CONCURRENCY || 3)));

  async function runTask(task) {
    const { lang, kind } = task;
    if (rateLimited) return { lang, kind, skipped: 'rate-limited-earlier' };
    if (left() < MIN_PER_LANG_MS) return { lang, kind, skipped: 'time-budget', leftMs: left() };

    const timeoutMs = Math.max(15000, Math.min(MAX_CALL_MS, left() - 10000));
    try {
      const r = await runBackfillBatch({
        lang, kind, timeoutMs,
        batch: kind === 'article' ? CRON_ARTICLE_BATCH : CRON_EDITORIAL_BATCH,
      });
      totalProcessed += r.processed || 0;
      return r;
    } catch (err) {
      const msg = String((err && err.message) || err);
      // 429 = Anthropic rate limit → 남은 언어는 다음 실행으로 미룬다.
      if (/Claude API 실패 \(429/.test(msg) || /rate.?limit/i.test(msg)) {
        rateLimited = true;
      }
      console.error('[cron/backfill-translations]', kind, lang, msg);
      return { lang, kind, error: msg.slice(0, 300) };
    }
  }

  for (let i = 0; i < ordered.length; i += CONCURRENCY) {
    // 예산이 바닥나면 남은 조합은 시도조차 하지 않는다(각 runTask 가 skip 을 반환).
    const wave = ordered.slice(i, i + CONCURRENCY);
    const done = await Promise.all(wave.map(runTask));
    for (const r of done) results.push(r);
  }

  /* 실행 요약을 cron_runs.note 에 남긴다 (2026-07-31 신설).
   *
   * 이게 없어서 12시간 · 31회 실행이 전부 ok 로 기록되는 동안 저장 0건인 걸
   * 아무도 몰랐다. ok 는 "함수가 안 죽었다" 는 뜻이지 "일을 했다" 가 아니다.
   * 조합별로 몇 건을 저장했는지·왜 못 했는지를 한 줄로 남겨 다음 실행부터
   * DB 만 봐도 판단할 수 있게 한다. */
  res.locals = res.locals || {};
  res.locals.cronNote = results.map((r) => {
    const tag = (r.lang || '?') + '/' + (r.kind || '?').slice(0, 3);
    if (r.error) return tag + ':ERR ' + String(r.error).slice(0, 60);
    if (r.skipped) return tag + ':skip(' + r.skipped + ')';
    return tag + ':' + (r.processed || 0)
      + (typeof r.remaining === 'number' ? '/남' + r.remaining : '');
  }).join(' · ') || '처리 대상 없음';

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
