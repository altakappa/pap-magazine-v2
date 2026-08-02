/**
 * PAP Magazine — 다국어 SEO 번역 백필 크론
 * Route: /api/cron/backfill-translations  (vercel.json crons 에 등록, 2분 주기)
 *
 * 주기 (2026-07-31 10분 → 5분 → 2분): 잔량이 19,600건(에디토리얼 9,499 +
 * 아티클 10,115)이고 목표가 9개 언어 100% 다. 실행당 처리량은 함수 상한
 * (120초)에 묶여 있어 더 못 늘린다 — 남은 손잡이는 실행 횟수뿐이다.
 * 실행이 겹칠 위험은 없다(최장 실행 85초 < 주기 120초).
 *
 * 2분으로 올린 근거는 추정이 아니라 실측이다. 03:23 실행이 55초에 에디토리얼
 * 32건을 에러 없이 처리했고(7개 언어 전부), 남은 30초는 아티클 웨이브 진입
 * 조건을 못 채워 그냥 버려졌다. 즉 실행당 처리량은 이미 한계에 가깝고
 * 실행 횟수를 늘리는 쪽이 남아 있었다.
 *
 * ⚠️ 한도에 닿는지는 note 로 판단한다. 429 가 보이면 주기를 되돌리거나
 * SEO_TRANSLATE_CONCURRENCY 를 낮춘다 — 여기서 계정 등급을 알 수 없다.
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
 *   ANTHROPIC_API_KEY               : 필수 (없으면 503)
 *   CRON_SECRET                     : (선택) Vercel cron 보호 — 다른 크론과 동일 규약
 *   SEO_TRANSLATE_LANGS             : (선택) 대상 언어 CSV, 기본 "it,fr,es,ja,de,ru,zh"
 *   SEO_TRANSLATE_KINDS             : (선택) 대상 종류 CSV, 기본 "editorial,article"
 *   SEO_TRANSLATE_CONCURRENCY       : (선택) 웨이브당 동시 실행 수 (1~8)
 *   SEO_TRANSLATE_EDITORIAL_BATCH   : (선택) 에디토리얼 배치, 기본 2
 *   SEO_TRANSLATE_ARTICLE_BATCH     : (선택) 아티클 배치, 기본 1        ← 2026-08-02 신설
 *   SEO_TRANSLATE_BUDGET_MS         : (선택) 실행 예산 ms, 기본 100000 (상한 100000)   ← 2026-08-02 신설
 *   SEO_TRANSLATE_CALL_MS_EDITORIAL : (선택) 에디토리얼 호출 타임아웃 ms, 기본 40000  ← 2026-08-02 신설
 *   SEO_TRANSLATE_CALL_MS_ARTICLE   : (선택) 아티클 호출 타임아웃 ms, 기본 60000      ← 2026-08-02 신설
 *   SEO_TRANSLATE_ROTATE            : (선택) "0" 이면 회전 없이 정의된 순서 고정(테스트용)
 *   SEO_TRANSLATE_BATCH             : ⚠️ 이 크론에서는 동작하지 않는다(응답에만 표시).
 *                                     실제 배치는 위 EDITORIAL/ARTICLE 두 개다.
 */

const { withCronGuard } = require('../_lib/cronGuard');   // 실행기록·실패알림 (2026-07-30)
const { runBackfillBatch, normalizeBatch, LANG_NAMES, KINDS } = require('../_lib/seoTranslateBackfill');

/* 숫자형 환경변수 읽기 (2026-08-02 신설).
 *
 * 왜 만드나 — 이 저장소는 push 를 사람이 직접 한다. 값 하나 바꾸자고 매번
 * 배포를 돌리면 튜닝이 사실상 멈춘다. 예산·타임아웃처럼 "실측 보고 조정해야
 * 하는 숫자"는 env 로 빼두면 배포 없이 Redeploy 만으로 돌릴 수 있다.
 * 상·하한을 코드가 강제하므로 오타로 함수를 죽일 수는 없다. */
const envMs = (name, dflt, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.max(min, Math.min(max, n)) : dflt;
};

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
/* 2026-08-02 — 85s → 100s 로 재상향 (재시도를 넣기 위한 전제).
 *
 * 아래 runTask 에 "타임아웃이 나면 배치를 반으로 줄여 다시 시도" 를 넣었는데,
 * 예산 85s 에서는 그 재시도가 **한 번도 못 돈다**. 첫 호출이 40s 를 쓰고
 * 실패하면 남은 시간은 45s 인데, 재시도 진입 조건이 52s(타임아웃 40s +
 * 여유 12s)라 항상 걸린다. 즉 예산을 안 올리면 재시도 코드는 죽은 코드다.
 * 100s 면 남는 시간이 60s 라 재시도가 실제로 돈다(시뮬레이션 확인).
 *
 * 100s 가 안전한 근거는 추정이 아니라 vercel.json 이다:
 *     "functions": { "api/**\/*.js": { "maxDuration": 120, "memory": 1024 } }
 * 그리고 이 파일의 모든 경로는 elapsed ≤ BUDGET_MS − WAVE_SLACK_MS = 88s
 * 안에서 끝나도록 짜여 있다(웨이브 진입 조건·재시도 진입 조건 둘 다 left()
 * 기준). 88s + 응답 직렬화 ≪ 120s.
 *
 * 상한도 100000 으로 막는다. tests/seo-translate-backfill.test.js 가
 * "예산 + 20s ≤ maxDuration" 을 지키는지 검사하는데, 환경변수로 그 위를
 * 넣을 수 있으면 그 검사가 의미를 잃는다. 예산을 더 키우고 싶으면 먼저
 * vercel.json 의 maxDuration 을 올리고 테스트를 함께 고칠 것. */
const BUDGET_MS = envMs('SEO_TRANSLATE_BUDGET_MS', 100000, 30000, 100000);

/* 종류별 호출 타임아웃 — 하나로 묶으면 둘 다 잘못된다.
 *   에디토리얼: 설명 한 줄짜리라 12건도 10초대에 끝난다.
 *   아티클     : 본문 평균 1,228자 → 2건이면 출력 4,000토큰, 40~60초.
 * 35초 하나로 묶여 있어서 아티클이 아슬아슬하게 잘리고 있었다. */
/* 아티클 45s 는 실측값이다 (2026-07-31 02:52 실행): 배치 2건짜리 호출이
 * 실제로 약 24초에 끝났다. 60s 로 잡아두면 "이 웨이브를 시작할 시간이
 * 남았는가" 검사가 과하게 보수적이 되어, 아티클은 실행의 첫 웨이브가
 * 아니면 아예 못 도는 상태가 된다. */
/* 2026-08-02 — 아티클 40s → 60s, 그리고 아티클 배치를 2 → 1 로 내린다.
 *
 * 위 주석의 "60s 는 과하게 보수적" 은 배치 2 기준의 판단이었다. 실측 결과
 * 배치 2 아티클은 8시간 동안 성공률 0~5% 였다 — 40s 안에 못 끝나 통째로
 * 버려지고, 같은 2건을 다음 실행에서 또 부른다(선택 순서가 고정이라 영원히
 * 같은 2건이다). "보수적이라 덜 돈다" 보다 "돌긴 도는데 전부 버린다" 가
 * 훨씬 나쁘다. 배치 1 + 타임아웃 60s 면 건당 12~30s 라 확실히 끝난다.
 * 진입 조건이 72s 로 올라가 아티클은 실행 앞부분에서만 한 웨이브 돌지만,
 * 그 한 웨이브가 실제로 저장된다. 0건 × 여러 웨이브보다 크다. */
const CALL_MS = {
  editorial: envMs('SEO_TRANSLATE_CALL_MS_EDITORIAL', 40000, 10000, 90000),
  article:   envMs('SEO_TRANSLATE_CALL_MS_ARTICLE',   60000, 10000, 90000),
};

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

/* 재시도해도 되는 실패 (2026-08-02 신설).
 *
 * 이 셋은 전부 "입력이 너무 커서 응답이 안 끝났다" 의 다른 얼굴이다:
 *   timeout / aborted : 제한 시간 안에 응답이 안 왔다
 *   max_tokens        : 응답이 길이 상한에서 잘렸다 (lib 가 명시적으로 던진다)
 *   파싱 실패 / 배열이 아님 / 배열을 찾지 못함 : 잘린 JSON 이라 배열이 안 닫혔다
 * ↑ parseJsonArray 는 이미 ```json 펜스를 indexOf('[') / lastIndexOf(']') 로
 *   걷어내므로, 펜스는 원인이 아니다. 잘림이 원인이다 — 그래서 답은 "작게".
 * 반대로 400/401/404 같은 건 몇 번을 다시 불러도 같은 결과라 재시도하지 않는다.
 *
 * ⚠️ 이 목록은 api/_lib/seoTranslateBackfill.js 의 throw 문구와 1:1로 맞춰야 한다.
 *    (2026-08-02 실측 로그에서 '번역 응답에서 JSON 배열을 찾지 못함' 이 관측되어 추가.
 *     응답이 너무 일찍 잘려 여는 대괄호조차 없을 때 parseJsonArray 가 던지는 문구다.
 *     이게 빠져 있으면 독일어(de)의 최다 실패 유형이 재시도되지 않는다.)
 *    lib 의 문구가 바뀌면 여기도 같이 고칠 것. */
const RETRYABLE_RE = /timeout|aborted|파싱 실패|max_tokens|배열이 아님|배열을 찾지 못함/i;
/* 재시도 때 호출 타임아웃을 늘려주되 이 값을 넘기지 않는다.
 * (배치를 1까지 줄였는데도 안 끝나는 '거대 한 건'을 위한 여유. 실측: fr·es
 *  에디토리얼 큐 맨 앞에 설명 7,387자짜리가 한 건 박혀 있다.) */
const MAX_RETRY_CALL_MS = 60000;
/* 이보다 짧은 시간밖에 안 남았으면 재시도하지 않는다 — 어차피 또 잘린다. */
const MIN_RETRY_CALL_MS = 20000;

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
   * 없어 아무도 몰랐다 — env 를 지워 코드를 단일 출처로 두는 편이 안전하다.
   *
   * 2026-08-02 확인: 운영 Vercel 에는 SEO_TRANSLATE_LANGS 가 **없다**.
   * 즉 지금 도는 언어는 이 줄의 기본값 7개가 그대로다(de 포함). */
  const langs = String(process.env.SEO_TRANSLATE_LANGS || 'it,fr,es,ja,de,ru,zh')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => LANG_NAMES[s]);

  /* ⚠️ 이 값은 이 크론에서 **아무 일도 하지 않는다** (2026-08-02 확인).
     아래 runTask 는 CRON_EDITORIAL_BATCH / CRON_ARTICLE_BATCH 만 쓴다.
     여기 남아 있는 이유는 응답 JSON 에 그대로 실려 나가기 때문 — 응답만
     보고 "배치 20으로 돌고 있구나" 하고 오해하기 딱 좋다. 지우지 않고
     표시로 남겨두되, 튜닝은 반드시 아래 두 개로 한다. */
  const batch = normalizeBatch(process.env.SEO_TRANSLATE_BATCH, 20);

  /* 2026-07-21 — 아티클 본문 번역 추가.
     ─────────────────────────────────────────────────────────────────
     (lang × kind) 조합을 한 바퀴 돌린다. 한 번 실행에 시간 예산(100초)
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

  /* 아티클 배치 — 2026-08-02 하드코딩 2 → env 로 빼고 기본 1.
   *
   * 하드코딩이었던 게 문제였다. 아티클 성공률이 0~5% 로 바닥인 걸 보고도
   * 배포 없이는 손댈 수가 없어서, 결국 SEO_TRANSLATE_KINDS=editorial 로
   * 아티클을 통째로 꺼버리는 것 말고는 방법이 없었다. 이제 숫자만 바꾸면 된다.
   * 기본 1인 이유는 위 CALL_MS 주석 참고 — 2는 40s 안에 안 끝났다. */
  const CRON_ARTICLE_BATCH = normalizeBatch(process.env.SEO_TRANSLATE_ARTICLE_BATCH, 1);
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
   * 8건 × 매회가 크다. 관리자 수동 실행은 시간 제약이 없어 기본값(20)을 쓴다.
   *
   * 2026-08-02 — 기본값을 4 → 2 로 내린다. env 로 2 를 넣어 돌려본 실측:
   * 저장 속도가 시간당 약 34건 → 100건 이상으로 뛰었고, 8시간 내내 0건이던
   * de 가 매 실행 2건씩 저장되기 시작했다(14:43 실행 = 41.7초에 6개 조합).
   * env 가 지워져도 이 값으로 돌게 기본값 자체를 내려둔다. */
  const CRON_EDITORIAL_BATCH = normalizeBatch(process.env.SEO_TRANSLATE_EDITORIAL_BATCH, 2);

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
   * 2~3개 조합밖에 못 돌았다. 9개 언어로 늘리면 한 조합이 차례를 받는 데
   * 몇 시간이 걸린다 — de·ru·zh 가 3개월째 1% 인 이유가 이것이다.
   * 서로 다른 (lang,kind) 는 다른 행을 건드리므로 동시에 돌아도 충돌하지 않는다.
   * 백필 서술문 크론에서 같은 방식으로 처리량이 두 배가 됐다.
   *
   * 429 가 나면 기존대로 남은 조합을 다음 실행으로 미룬다. 값을 env 로 뺀 이유:
   * Anthropic 의 분당 출력 토큰 한도는 계정 등급에 따라 다르고 여기서 알 수 없다.
   * 429 가 note 에 찍히면 낮추면 된다 — 추측으로 박아두지 않는다. */
  /* 종류별로 나눈다 (2026-07-31, 첫 정상 실행 실측 후).
   *   에디토리얼 7 — 설명 한 줄짜리라 가볍다. 언어가 7개이므로 한 웨이브에
   *     전부 담긴다(5 였을 때는 5+2 로 쪼개져 웨이브 하나를 더 썼다).
   *   아티클 4 — 본문 번역은 건당 출력 2,000토큰대다. 7개를 동시에 던지면
   *     한 웨이브에서만 5만 토큰이 넘어가 분당 한도를 건드릴 위험이 크다.
   * 무거운 쪽만 낮추면 가벼운 쪽 처리량을 희생하지 않는다. */
  /* 2026-08-02 실측: 동시 7 은 과했다. env 로 3 을 넣자 시간당 저장이
   * 18건 → 34건으로 늘었다(동시에 많이 던질수록 각 호출이 느려져 타임아웃
   * 확률이 올라간다). 운영에는 SEO_TRANSLATE_CONCURRENCY=3 이 설정돼 있다. */
  const cfgConc = Number(process.env.SEO_TRANSLATE_CONCURRENCY || 0);
  const CONCURRENCY_BY_KIND = cfgConc > 0
    ? { editorial: cfgConc, article: cfgConc }
    : { editorial: 7, article: 4 };
  const concOf = (kind) => Math.max(1, Math.min(8, CONCURRENCY_BY_KIND[kind] || 4));

  /* 잔량이 0 이라고 보고한 조합은 이번 실행에서 다시 부르지 않는다.
     (it 에디토리얼처럼 이미 100% 인 조합이 링을 돌 때마다 자리를 잡아먹는다) */
  const finished = new Set();
  const key = (t) => t.lang + '|' + t.kind;

  /* 실패한 배치를 반으로 줄여 다시 시도한다 (2026-08-02 신설).
   *
   * ── 왜 필요한가 (실측) ──────────────────────────────────────────
   * 지금 구조는 한 번의 Claude 호출에 여러 건을 묶어 보낸다. 그 호출이
   * 타임아웃되면 **묶인 전부가 버려진다.** 그리고 다음 실행에서 고르는
   * 순서가 published_date desc 로 고정이라 **똑같은 건들을 또 고른다.**
   * 즉 큐 맨 앞에 무거운 항목이 하나 박히면 그 조합은 영구히 0건이 된다.
   * 실제로 fr·es 에디토리얼 큐 맨 앞에 설명 7,387자짜리가 한 건 있고,
   * 3시간 성공률이 fr 2.4% / es 0.0% 였다(같은 시간 zh 15% · ru 14%).
   *
   * ── 무엇을 하는가 ───────────────────────────────────────────────
   * 재시도 가능한 실패(잘림 계열)면 배치를 반으로 줄이고, 남은 예산이
   * 허락하는 만큼 타임아웃을 늘려 다시 부른다. 배치 2 → 1 로 줄어들면
   * 무거운 한 건만 남으므로, 그 한 건에 최대 60초를 준다.
   * 429 는 예외 — 즉시 멈추고 다음 실행으로 미룬다(기존 동작 유지).
   *
   * ── 함수 상한을 넘지 않는 근거 ──────────────────────────────────
   * 재시도 타임아웃 = min(60s, left() − 12s) 이므로, 재시도가 끝나는
   * 시점은 항상 elapsed ≤ BUDGET_MS − WAVE_SLACK_MS = 88s 다.
   * 웨이브 진입 조건도 같은 기준이라 어느 경로로도 88s 를 못 넘는다.
   * vercel.json 의 maxDuration 은 120s. */
  async function runTask(task) {
    const { lang, kind } = task;
    let curBatch = cjkScale(lang, kind === 'article' ? CRON_ARTICLE_BATCH : CRON_EDITORIAL_BATCH);
    let curTimeout = CALL_MS[kind] || CALL_MS.editorial;
    let lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await runBackfillBatch({ lang, kind, timeoutMs: curTimeout, batch: curBatch });
        totalProcessed += r.processed || 0;
        if (r.remaining === 0) finished.add(key(task));
        /* lang·kind 는 호출자가 아는 사실이다 — 반환값이 되돌려주기를 기대하지
           않는다. 하나라도 빠지면 아래 집계에서 조합을 못 찾아 잔량이 통째로
           'undefined' 가 된다(실제로 테스트가 이걸 잡았다). */
        return Object.assign({}, r, { lang, kind });
      } catch (err) {
        const msg = String((err && err.message) || err);
        // 429 = Anthropic rate limit → 재시도 금지. 남은 조합은 다음 실행으로 미룬다.
        if (/Claude API 실패 \(429/.test(msg) || /rate.?limit/i.test(msg)) {
          rateLimited = true;
          console.error('[cron/backfill-translations]', kind, lang, msg);
          return { lang, kind, error: msg.slice(0, 300) };
        }
        lastErr = msg;
        if (!RETRYABLE_RE.test(msg)) break;

        const nextBatch = Math.max(1, Math.floor(curBatch / 2));
        const nextTimeout = Math.min(MAX_RETRY_CALL_MS, left() - WAVE_SLACK_MS);
        // 남은 시간이 없으면 포기 — 다음 실행이 이어받는다.
        if (nextTimeout < MIN_RETRY_CALL_MS) break;
        // 더 줄일 배치도 없고 시간도 못 늘리면 다시 불러봐야 같은 결과다.
        if (nextBatch === curBatch && nextTimeout <= curTimeout) break;

        curBatch = nextBatch;
        curTimeout = nextTimeout;
        console.error('[cron/backfill-translations] retry', kind, lang,
          'batch=' + curBatch, 'timeout=' + curTimeout, msg.slice(0, 80));
      }
    }
    console.error('[cron/backfill-translations]', kind, lang, lastErr);
    return { lang, kind, error: String(lastErr).slice(0, 300) };
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
    const waveMax = concOf(kindOfWave);
    const picked = [];
    for (let n = 0; n < alive.length && picked.length < waveMax; n++) {
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
