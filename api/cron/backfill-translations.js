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
 *                                     (2026-08-05 editorial 을 뺐다가 같은 날 되돌림 —
 *                                      색인은 noindex 로 막고 번역은 유지. 아래 주석)
 *   SEO_TRANSLATE_MAX_AGE_DAYS      : (선택) 이 일수보다 오래된 발행분은 번역하지 않는다.
 *                                     **기본 0(제한 없음)** — 2026-08-06 90 에서 바꿈.
 *                                     검색이 아니라 사이트 경험이 근거다(아래 주석)
 *   SEO_TRANSLATE_MAX_SRC_CHARS     : (선택) 원문이 이보다 길면 자동 번역에서 제외.
 *                                     기본 6000, 0 이면 제한 없음   ← 2026-08-05 신설
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
  /* 이 시각을 넘겨서까지 Claude 를 부르지 않는다 (2026-08-04 Patch 6).
   *
   * 전에는 이 약속이 **주석에만** 있었다. 바깥에서 "웨이브에 들어가려면
   * CALL_MS + 여유가 남아 있어야 한다" 고 지켰지만, 안쪽 runBackfillBatch 는
   * Patch 5 이후 한 번 불릴 때 호출을 최대 6번(배치+단건 × 3패스) 할 수
   * 있게 됐다. 약속을 지킬 책임이 있는 쪽이 약속을 모르고 있었던 셈이다.
   * 이제 마감시각 자체를 넘겨, 호출 하나하나가 직접 확인하게 한다. */
  const deadlineAt = started + BUDGET_MS - WAVE_SLACK_MS;

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
  /* ─── 2026-08-05 — 발행 나이로 자른다 (GSC 실측) ────────────────────
   *
   * 한국어 원문 기사의 클릭을 발행 나이로 갈라 본 결과(7/1~8/4, 46쪽):
   *     30일 이내 236클릭(81.1%) · 31~90일 53클릭(18.2%)
   *     91일~1년 2클릭(0.7%)     · 1년 초과 **0클릭(0.0%)**
   * 클릭의 99.3% 가 발행 90일 안에서 나온다. 1년 넘은 기사는 원문(한국어)
   * 조차 클릭이 0이다.
   *
   * 그런데 남은 번역 백필이 정확히 그 구간이었다. 크론이 published_date DESC
   * 로 돌아 최신부터 끝냈기 때문에 남은 8,282건은 전부 오래된 것들이다
   * (de 기준: 90일 이내 0건, 1년 초과 1,038건(61%), 가장 최근 미번역 발행일
   * 2026-04-12, 가장 오래된 2019-08-22). 원문으로도 안 팔리는 기사를
   * 7개 언어로 번역하고 있었다.
   *
   * '번역하면 그 언어권엔 새 콘텐츠 아닌가' 는 성립하지 않는다 — 2023년
   * 컴백 뉴스를 오늘 검색하는 사람은 어느 언어에도 없다. 언어가 아니라
   * 시간의 문제다. 그래서 언어가 아니라 나이로 자른다.
   *
   * 신규 발행(월 230건 × 7언어)은 그대로 처리된다 — 클릭이 나는 구간이다.
   *
   * ⚠️ 에버그린 예외: 리스티클·인터뷰·에세이는 오래돼도 수요가 있다
   * (7-interactive-websites… 11클릭, '사형수의 마지막 식사',
   *  '레이 카와쿠보 vs 준야 와타나베'). 그래서 이 컷은 **크론에만** 건다.
   * 관리자 수동 엔드포인트(api/admin/backfill-translations)는 sinceDate 를
   * 넘기지 않으므로 나이 제한 없이 아무 기사나 골라 번역할 수 있다.
   * 근거: 볼트 45_Business/PAP_SEO_가이드라인_2026-08-05.md (2-3절) */
  /* ─── 2026-08-06 — 나이 컷을 뗀다 (기본 90 → 0) ─────────────────────
   *
   * 위 2026-08-05 주석의 검색 근거는 여전히 사실이다: 오래된 기사는 원문
   * 조차 클릭이 거의 없다(91일~1년 0.7% · 1년 초과 0.0%). 07-01~26 상위
   * 100쪽 중 90일 초과는 단 1쪽(eden-vodka, 174일, 2클릭)이었다.
   *
   * 그런데 **검색은 이 결정의 근거가 아니다.** 사이트 경험이 근거다.
   *
   *   api/seo/article/[slug].js:167 —
   *     번역이 없으면 비-ko/en 방문자를 /en 으로 302 리다이렉트한다.
   *
   * 발행 기사 2,282편 중 자국어로 볼 수 있는 비율(2026-08-06 실측):
   *     it·es 74.5% · fr 69.9% · ja 58.5% · ru 27.2% · de 24.9% · zh 22.4%
   * **중국어 구독자는 기사 10개 중 8개가 영어로 튕긴다.** PAP 은 검색
   * 트래픽이 아니라 9개 언어 커뮤니티 플랫폼을 지향한다. 같은 날 에디토리얼
   * 번역을 되살린 것과 같은 이유이며, 기사에 다른 잣대를 댈 이유가 없다.
   *
   * 비용도 걸림돌이 아니다: 미번역 7,921쌍 · 평균 원문 1,241자 ·
   * sonnet-4-5 기준 쌍당 약 $0.011 → 총 약 $90. 그리고 크론은 지금 놀고
   * 있다(08-06 note: 전 조합 잔여 0, 실행당 0~2초, AI 호출 0). 남는 용량을
   * 쓰는 것이지 새로 사는 게 아니다.
   *
   * 신규가 밀리지 않는 이유: 큐가 published_date DESC 라 새 기사가 항상
   * 먼저 나간다(마이그레이션 100·103의 order by). 백로그는 그 뒤를 채운다.
   *
   * ⚠️ 6,000자 상한(SEO_TRANSLATE_MAX_SRC_CHARS)은 그대로 둔다 — 그건
   * 나이가 아니라 poison pill 방지이고 근거가 다르다(마이그레이션 103).
   * ⚠️ 이 기본값을 다시 바꾸면 마이그레이션 106 의 감시 함수와
   * tests/seo-thin-page-policy.test.js 도 함께 바꿔야 한다. 앱과 감시가
   * 어긋나면 2026-08-05 '잔량 8,124 오경보'가 재발한다.
   * 근거 문서: 볼트 45_Business/PAP_기사번역_전량검토_2026-08-06.md */
  const MAX_AGE_DAYS = (() => {
    const raw = process.env.SEO_TRANSLATE_MAX_AGE_DAYS;
    if (raw === undefined || raw === '') return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);            // 0 = 제한 없음
  })();
  const sinceDate = MAX_AGE_DAYS > 0
    ? new Date(started - MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10)
    : null;

  /* ─── 2026-08-05 — 원문 길이 상한 (poison pill 차단) ────────────────
   *
   * 사건: 90일 컷 배포 후 zh 잔여 181건이 3시간 동안 한 건도 줄지 않았다.
   * 매 실행 AI 호출 2회(약 80초)를 쓰고 저장 0건 — 하루 1,440회 헛호출.
   *
   * 원인은 큐 맨 앞에 박힌 두 건이었다:
   *     'Acne Studios 30주년 애프터 파티'      9,052자
   *     '밀란 패션위크 SS27 스트릿 스타일'    12,963자
   * 중국어는 출력 토큰이 2~3배라 호출 타임아웃 안에 못 끝내는데, 큐가
   * published_date DESC 고정이라 매 실행 같은 두 건을 다시 시도했다.
   * 뒤의 179건은 영원히 차례가 오지 않았다.
   *
   * 이 저장소가 이미 겪은 패턴이다 — 에디토리얼은 EDITORIAL_SRC_MAX(1,200)
   * 로 막아 뒀는데 아티클에는 그 상한이 없었다.
   *
   * 임계값 근거(실측): 성공한 zh 아티클 번역 329건의 원문 길이는
   * 최대 2,293자 · 중앙값 1,222 · p99 1,764 이고 6,000자 초과 성공은 0건.
   * zh 잔여 181건 중 6,000 초과는 2건뿐 — 그 2건을 빼면 179건이 풀린다.
   *
   * 자르지 않고 제외하는 이유: 잘린 본문을 저장하면 문장이 끊긴 페이지가
   * 사용자에게 나간다. 제외분은 관리자 수동 엔드포인트로 처리한다
   * (거기는 상한을 넘기지 않으므로 길이 제한이 없다). */
  const MAX_SRC_CHARS = (() => {
    const raw = process.env.SEO_TRANSLATE_MAX_SRC_CHARS;
    if (raw === undefined || raw === '') return 6000;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 6000;
    return Math.floor(n);            // 0 = 제한 없음
  })();

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
  /* ─── 2026-08-05 — 에디토리얼 번역: 뺐다가 같은 날 되돌린다 ────────
   *
   * ① 오전에 뺐던 이유 (GSC 실측, 7/1~8/4):
   *    색인된 /es/ 79쪽 중 클릭이 있는 건 4쪽이고 그중 에디토리얼은 0쪽.
   *    전 언어를 통틀어 클릭이 난 번역 페이지는 예외 없이 /article/ 이었다.
   *    이 관찰 자체는 지금도 유효하다.
   *
   * ② 그런데 그때 붙였던 설명은 틀렸다.
   *    "에디토리얼은 설명이 평균 15자라 랭킹할 텍스트가 없다" 고 적었는데,
   *    실측해 보니 아니다 — 1년 초과 평균 863자 · 90일~1년 659자 ·
   *    최근 90일 388자, 300자 초과가 99% 다. 저장소에 오래 적혀 있던 문장
   *    (091 마이그레이션 주석)을 검증 없이 옮겨 쓴 것이었다.
   *    클릭 0 은 사실이지만 **원인은 아직 확정되지 않았다**(화보 특성상
   *    검색 의도와 안 맞거나, 제목이 스타일라이즈드 고유명사라 질의어와
   *    안 겹치거나, 서술적 설명이 특정 질의에 매칭되지 않거나).
   *
   * ③ 되돌리는 진짜 이유는 SEO 가 아니라 **사이트 경험**이다.
   *    api/seo/editorial/[slug].js 는 번역이 없으면 비-ko/en 방문자를
   *    /en 으로 302 리다이렉트한다. 사이트 안 언어 전환기도 같은
   *    seo_translations 를 읽는다(api/editorials/[id].js).
   *    번역을 끊으면 이탈리아어·스페인어 구독자가 **신규 화보를 자국어로
   *    볼 수 없게 된다.** PAP 는 검색 트래픽이 아니라 9개 언어 커뮤니티
   *    플랫폼을 지향하므로, 구독자 경험을 깎아 검색 점수를 얻는 건 방향이 반대다.
   *
   * ④ 검색 쪽 보호는 그대로 유지된다 — 색인은 _lib/seoRenderer.js 의
   *    noindexTranslatedEditorial 이 막는다. **번역은 만들되 색인은 안 한다.**
   *    둘은 분리 가능하고, 분리하는 것이 맞다.
   *
   * 비용: 신규 에디토리얼 월 18편 × 7언어 ≈ 126건/월. 오늘 없앤 8,100건에
   * 비하면 무시할 수준이다. 기존 분은 이미 완주해 잔여 0 이라 부하도 없다. */
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
   * vercel.json 의 maxDuration 은 120s.
   *
   * 2026-08-04 — 위 문단은 한동안 사실이 아니었다. Patch 5 가 runBackfillBatch
   * 안에 단건 재시도와 3패스 반복을 넣으면서 "한 번 = 호출 하나" 전제가
   * 깨졌고, 실측 평균이 94~138초, 최대 151초까지 올라가 6시간에 22번
   * 강제종료됐다. deadlineAt 을 넘겨 안쪽이 직접 지키게 해서 되돌렸다. */
  async function runTask(task) {
    const { lang, kind } = task;
    let curBatch = cjkScale(lang, kind === 'article' ? CRON_ARTICLE_BATCH : CRON_EDITORIAL_BATCH);
    let curTimeout = CALL_MS[kind] || CALL_MS.editorial;
    let lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await runBackfillBatch({ lang, kind, timeoutMs: curTimeout, batch: curBatch, deadlineAt, sinceDate, maxSrcChars: MAX_SRC_CHARS });
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
  /* ─── 2026-08-05 계측 ───────────────────────────────────────────────
   *
   * 왜: 오늘 오전 큐를 RPC 로 내려 DB 전송 8.5MB 를 없앴는데(실측 확인),
   * 시간당 저장이 61→43 건으로 **줄고** 평균 실행시간은 69→80초로 늘었다.
   * 진단이 반만 맞았던 것이다 — 80초가 어디에 쓰이는지 재보지 않고 큰 숫자만
   * 보고 원인이라 결론냈다. 이 파일의 주석 역사가 보여주듯 이 크론은 계속
   * 추측으로 튜닝돼 왔다. 그 고리를 끊으려면 다음 조치가 아니라 **계측**이
   * 먼저다. note 에 내역을 남겨 눈으로 보고 판단한다.
   *
   * 남기는 값(초 단위): 큐조회 / AI호출 / 저장 / 웨이브 수 / 마지막에 남은 예산.
   * 조합들이 병렬로 도니 합계는 벽시계보다 클 수 있다 — 그게 정상이고,
   * '어디가 큰가' 를 보는 것이 목적이다. */
  const T = { queueMs: 0, callMs: 0, saveMs: 0, calls: 0, waves: 0 };
  let lastLeftMs = null;

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
      lastLeftMs = left();
      results.push({ kind: kindOfWave, skipped: 'time-budget', leftMs: left(), needMs: need });
      break;
    }

    T.waves++;
    const done = await Promise.all(picked.map(runTask));
    for (const r of done) {
      results.push(r);
      const t = r && r.timing;
      if (t) {
        T.queueMs += t.queueMs || 0;
        T.callMs += t.callMs || 0;
        T.saveMs += t.saveMs || 0;
        T.calls += t.calls || 0;
      }
    }
    lastLeftMs = left();
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
    const cur = perCombo.get(k) || { processed: 0, remaining: null, err: null, tooLong: 0, flagged: 0 };
    cur.processed += r.processed || 0;
    if (typeof r.remaining === 'number') cur.remaining = r.remaining;
    if (r.skipped_too_long) cur.tooLong = r.skipped_too_long;
    /* 표기 규칙(한글 잔존·한국 고유명사)을 재시도까지 하고도 못 지켜 그대로
       저장한 건수. 0 이 아닌 상태가 계속되면 프롬프트를 다시 손봐야 한다. */
    cur.flagged += r.quality_flagged || 0;
    if (r.error && !cur.err) cur.err = String(r.error).slice(0, 50);
    perCombo.set(k, cur);
  }
  /* 계측 한 줄 — 항상 note 끝에 붙인다. 초 단위, 소수 1자리.
     예) ⏱큐0.9/AI58.4/저장0.3s·콜3·웨이브2·남은21s
     (조합이 병렬이라 합계가 벽시계보다 클 수 있다 — 비율을 보는 값이다.) */
  const s1 = (ms) => (Math.round(ms / 100) / 10);
  const timingNote = '⏱큐' + s1(T.queueMs) + '/AI' + s1(T.callMs) + '/저장' + s1(T.saveMs)
    + 's·콜' + T.calls + '·웨' + T.waves
    + (lastLeftMs === null ? '' : '·남' + s1(lastLeftMs) + 's')
    /* 어떤 나이 컷으로 돌았는지 남긴다 — 잔여가 갑자기 줄었을 때
       '컷 때문인가 다 끝난 건가' 를 로그만 보고 구분할 수 있어야 한다. */
    + (sinceDate ? '·컷' + MAX_AGE_DAYS + 'd' : '·컷없음');

  /* cronGuard 가 note 를 500자로 자른다. 계측을 그냥 뒤에 붙이면 조합이 많은
     실행에서 계측만 잘려나가 — 정작 보려던 값이 사라진다. 조합 쪽을 먼저
     줄이고 계측은 반드시 살린다. */
  const comboNote = [
    ...Array.from(perCombo.entries()).map(([k, v]) =>
      k + ':' + v.processed
      + (v.remaining === null ? '' : '/남' + v.remaining)
      /* 길이로 뺀 건수는 '잔여'와 따로 보여야 한다 — 합치면 큐가 막힌 걸
         '할 일이 남았다'로 착각한다(오늘 zh 사고). */
      + (v.tooLong ? '/긴글' + v.tooLong : '')
      + (v.flagged ? '/품질' + v.flagged : '')
      + (v.err ? ' ERR ' + v.err : '')),
    ...notes,
  ].join(' · ') || '처리 대상 없음';
  res.locals.cronNote = comboNote.slice(0, 500 - timingNote.length - 3) + ' · ' + timingNote;

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
    // 2026-08-05 계측 — 관리자가 응답만 봐도 80초의 내역을 알 수 있게.
    timing: { queueMs: T.queueMs, callMs: T.callMs, saveMs: T.saveMs, calls: T.calls, waves: T.waves, lastLeftMs },
    maxAgeDays: MAX_AGE_DAYS || undefined,
    maxSrcChars: MAX_SRC_CHARS || undefined,
    sinceDate: sinceDate || undefined,
    results,
  });
}, { silenceTransient: true });
