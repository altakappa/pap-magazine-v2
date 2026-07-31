/**
 * PAP Magazine — 다국어 SEO 번역 백필 크론
 * Route: /api/cron/backfill-translations  (vercel.json crons 에 등록, 5분 주기)
 *
 * 주기 (2026-07-31 10분 → 5분): 잔량이 19,600건(에디토리얼 9,499 + 아티클
 * 10,115)이고 목표가 9개 언어 100% 다. 실행당 처리량은 함수 상한(120초)에
 * 묶여 있어 더 못 늘린다 — 남은 손잡이는 실행 횟수뿐이다. 실행이 겹칠 위험은
 * 없다(최장 실행 95초 < 주기 300초).
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
/* 2026-07-31 — 75s → 95s 로 재상향.
 * 낮췄던 이유(완주율)는 유효했지만, 완주를 깨던 진짜 원인은 예산이 아니라
 * 순차 처리였다. 조합 하나가 Claude 를 기다리는 30~60초 동안 함수가 놀았고,
 * 그 대기가 쌓여 상한을 넘겼다. 이제 웨이브 단위로 병렬 처리하고, 웨이브를
 * 시작하기 전에 "이 웨이브가 끝날 시간이 남았는가"를 확인한다.
 * 함수 상한 120s 대비 25s 의 여유 — 응답 직렬화·로그 기록 몫이다. */
const BUDGET_MS = 85000;

/* 종류별 호출 타임아웃 — 하나로 묶으면 둘 다 잘못된다.
 *   에디토리얼: 설명 한 줄짜리라 12건도 10초대에 끝난다.
 *   아티클     : 본문 평균 1,228자 → 2건이면 출력 4,000토큰, 40~60초.
 * 35초 하나로 묶여 있어서 아티클이 아슬아슬하게 잘리고 있었다. */
/* 아티클 45s 는 실측값이다 (2026-07-31 02:52 실행): 배치 2건짜리 호출이
 * 실제로 약 24초에 끝났다. 60s 로 잡아두면 "이 웨이브를 시작할 시간이
 * 남았는가" 검사가 과하게 보수적이 되어, 아티클은 실행의 첫 웨이브가
 * 아니면 아예 못 도는 상태가 된다. */
const CALL_MS = { editorial: 40000, article: 45000 };

/* 일본어·중국어는 같은 내용도 출력 토큰이 2~3배다 (2026-07-31 실측).
 *
 * 라이브 로그: `[cron/backfill-translations] editorial ja The operation was
 * aborted due to timeout` — 같은 배치 8건에서 fr·es 는 통과하는데 ja 만
 * 매번 타임아웃이었다. ja 에디토리얼이 7/22 이후 한 건도 안 늘어난 데는
 * 이 이유도 겹쳐 있다.
 *
 * 시간을 더 주는 것보다 배치를 줄이는 쪽이 맞다 — 타임아웃이 나면 이미
 * 번역된 응답까지 통째로 버려지기 때문에, 아슬아슬하게 맞추면 계속 0건이다. */
const CJK_LANGS = new Set(['ja', 'zh']);
const cjkScale = (lang, batch) => (CJK_LANGS.has(lang) ? Math.max(1, Math.ceil(batch / 2)) : batch);
/* 웨이브를 시작하려면 그 웨이브의 타임아웃 + 이만큼의 여유가 남아 있어야 한다.
 * (응답 저장·직렬화 몫. 이게 없으면 마지막 웨이브가 함수 상한을 넘겨 죽고,
 *  죽으면 cronGuard 기록조차 안 남아 무슨 일이 있었는지 알 수 없다.) */
const WAVE_SLACK_MS = 12000;

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
  /* 에디토리얼 배치 — 크론에서는 20 이 아니라 4 다 (2026-07-31, 실측 2회 반영).
   *
   * 왜: 조합당 Claude 호출에는 타임아웃이 걸려 있고, 배치가 크면 그 안에
   * 못 끝난다. 타임아웃이 나면 이미 번역된 응답까지 통째로 버려지고 0건이
   * 저장된다 — 실패가 아니라 '아무 일도 없었음'으로 보였다. 실측: 12시간
   * 31회 실행 전부 ok, es/fr/ja 에디토리얼 저장 0건 (es 는 7/24, ja 는
   * 7/22 이후 한 건도 안 늘었다). 아티클(배치 2)만 꾸준히 돌던 이유가 이것.
   *
   * 20 → 8 로 줄였더니 fr·es 는 통과했는데(02:37), 동시 실행을 3→5 로
   * 올리자 배치 8 도 다시 타임아웃했다(03:03). 같은 실행에서 배치 4 인
   * ja 는 통과했다. 즉 한계는 배치 하나가 아니라 **배치 × 동시 실행**이다.
   * 8 은 그 경계 위에 있다 → 4 로 내려 확실히 끝나게 한다.
   *
   * 배치를 줄이면 실행당 처리량은 줄지만 **버려지지 않는다.** 20건 × 0회보다
   * 8건 × 매회가 크다. 관리자 수동 실행은 시간 제약이 없어 기본값(20)을 쓴다. */
  const CRON_EDITORIAL_BATCH = normalizeBatch(process.env.SEO_TRANSLATE_EDITORIAL_BATCH, 4);

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
   * 429 가 나면 기존대로 남은 조합을 다음 실행으로 미룬다. 값을 env 로 뺀 이유:
   * Anthropic 의 분당 출력 토큰 한도는 계정 등급에 따라 다르고 여기서 알 수 없다.
   * 429 가 note 에 찍히면 낮추면 된다 — 추측으로 박아두지 않는다. */
  const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SEO_TRANSLATE_CONCURRENCY || 5)));

  /* 잔량이 0 이라고 보고한 조합은 이번 실행에서 다시 부르지 않는다.
     (it 에디토리얼처럼 이미 100% 인 조합이 링을 돌 때마다 자리를 잡아먹는다) */
  const finished = new Set();
  const key = (t) => t.lang + '|' + t.kind;

  async function runTask(task) {
    const { lang, kind } = task;
    try {
      const r = await runBackfillBatch({
        lang, kind,
        timeoutMs: CALL_MS[kind] || CALL_MS.editorial,
        batch: cjkScale(lang, kind === 'article' ? CRON_ARTICLE_BATCH : CRON_EDITORIAL_BATCH),
      });
      totalProcessed += r.processed || 0;
      if (r.remaining === 0) finished.add(key(task));
      /* lang·kind 는 호출자가 아는 사실이다 — 반환값이 되돌려주기를 기대하지
         않는다. 하나라도 빠지면 아래 집계에서 조합을 못 찾아 잔량이 통째로
         'undefined' 가 된다(실제로 테스트가 이걸 잡았다). */
      return Object.assign({}, r, { lang, kind });
    } catch (err) {
      const msg = String((err && err.message) || err);
      // 429 = Anthropic rate limit → 남은 조합은 다음 실행으로 미룬다.
      if (/Claude API 실패 \(429/.test(msg) || /rate.?limit/i.test(msg)) {
        rateLimited = true;
      }
      console.error('[cron/backfill-translations]', kind, lang, msg);
      return { lang, kind, error: msg.slice(0, 300) };
    }
  }

  /* 링을 예산이 다할 때까지 **반복해서** 돈다 (2026-07-31).
   *
   * 전에는 조합 목록을 한 바퀴만 돌고 끝냈다. 조합이 14개(7언어 × 2종류)라
   * 한 바퀴면 예산이 남아도 함수가 그냥 종료됐다 — 특히 에디토리얼은 호출이
   * 10초대라 예산의 대부분이 그냥 버려졌다. 잔량이 19,000건이 넘는 상황에서
   * 남은 시간을 안 쓰는 건 그만큼 완주를 미루는 것이다.
   *
   * 웨이브는 **종류별로 묶는다** — 타임아웃이 다르기 때문이다. 섞으면 빠른
   * 에디토리얼이 느린 아티클을 기다리며 예산을 같이 태운다. */
  const MAX_WAVES = 40;   // 무한 루프 방지 (정상적으로는 예산이 먼저 끝난다)
  let cursor = 0;
  for (let wave = 0; wave < MAX_WAVES && !rateLimited; wave++) {
    // 아직 남은 조합만 후보로. 한 바퀴 다 끝났으면 더 할 일이 없다.
    const alive = ordered.filter(t => !finished.has(key(t)));
    if (!alive.length) break;

    // 커서에서 시작해 같은 kind 끼리 최대 CONCURRENCY 개를 모은다.
    const start = cursor % alive.length;
    const kindOfWave = alive[start].kind;
    const picked = [];
    for (let n = 0; n < alive.length && picked.length < CONCURRENCY; n++) {
      const t = alive[(start + n) % alive.length];
      if (t.kind === kindOfWave && !picked.includes(t)) picked.push(t);
    }
    cursor = start + picked.length;

    const need = (CALL_MS[kindOfWave] || CALL_MS.editorial) + WAVE_SLACK_MS;
    if (left() < need) {
      results.push({ kind: kindOfWave, skipped: 'time-budget', leftMs: left(), needMs: need });
      break;
    }

    const done = await Promise.all(picked.map(runTask));
    for (const r of done) results.push(r);
  }
  if (rateLimited) results.push({ skipped: 'rate-limited-stop' });

  /* 실행 요약을 cron_runs.note 에 남긴다 (2026-07-31 신설).
   *
   * 이게 없어서 12시간 · 31회 실행이 전부 ok 로 기록되는 동안 저장 0건인 걸
   * 아무도 몰랐다. ok 는 "함수가 안 죽었다" 는 뜻이지 "일을 했다" 가 아니다.
   * 조합별로 몇 건을 저장했는지·왜 못 했는지를 한 줄로 남겨 다음 실행부터
   * DB 만 봐도 판단할 수 있게 한다. */
  res.locals = res.locals || {};
  /* 링을 여러 바퀴 도므로 같은 조합이 여러 번 나온다 — 조합 단위로 합쳐야
     500자 안에 들어가고 읽을 수 있다. 잔량은 마지막 값이 최신이다. */
  const perCombo = new Map();
  const notes = [];
  for (const r of results) {
    if (!r.lang) { if (r.skipped) notes.push('skip(' + r.skipped + ')'); continue; }
    const k = r.lang + '/' + String(r.kind || '?').slice(0, 3);
    const cur = perCombo.get(k) || { processed: 0, remaining: null, err: null };
    cur.processed += r.processed || 0;
    if (typeof r.remaining === 'number') cur.remaining = r.remaining;
    if (r.error && !cur.err) cur.err = String(r.error).slice(0, 50);
    perCombo.set(k, cur);
  }
  res.locals.cronNote = [
    ...Array.from(perCombo.entries()).map(([k, v]) =>
      k + ':' + v.processed
      + (v.remaining === null ? '' : '/남' + v.remaining)
      + (v.err ? ' ERR ' + v.err : '')),
    ...notes,
  ].join(' · ') || '처리 대상 없음';

  /* 조합별 최신 잔량 합계. 전 조합을 한 번이라도 확인했을 때만 '완주' 판정한다 —
     확인 못 한 조합이 있으면 합계는 실제보다 작아 착시가 된다. */
  const remainingTotal = Array.from(perCombo.values())
    .reduce((a, v) => a + (v.remaining || 0), 0);
  const allMeasured = ordered.every(t =>
    (perCombo.get(t.lang + '/' + String(t.kind).slice(0, 3)) || {}).remaining !== null
    && perCombo.has(t.lang + '/' + String(t.kind).slice(0, 3)));

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
