/**
 * PAP Magazine — 화보 FAQ 백필 크론 (2026-08-27 신설)
 * Route: /api/cron/backfill-editorial-faq   (vercel.json: 10분마다, 완주 후 무해 공회전)
 *
 * 기사 FAQ 크론(backfill-faq.js)과 같은 뼈대 — 로직은 editorialFaqBackfill.js 하나.
 * 대상: 발행 화보 2,303편 중 설명문 보유 2,291편 (2026-08-27 기준, faq 0에서 시작).
 */

const { bearerOk } = require('../_lib/secretCompare');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { runEditorialFaqBackfillBatch } = require('../_lib/editorialFaqBackfill');
const { runEditorialFaqI18nBatch } = require('../_lib/editorialFaqI18nBackfill');
const { normalizeBatch } = require('../_lib/faqBackfill');

module.exports = withCronGuard('backfill-editorial-faq', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
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
    /* 100초 → 270초 (2026-09-04). 함수 상한을 120 → 300 으로 올렸다.
       ■ 왜 이게 안전한가
         · 300 은 이 저장소가 **이미 쓰고 있는 값**이다 (weekly-news · trend-scout ·
           ai-sov-probe · ig-comment-scan · celeb-brief). 새로 시험하는 숫자가 아니다.
         · 크론 주기가 10분(600초)이라 270초는 다음 회차와 겹치지 않는다.
         · 콜 하나하나는 **오늘과 완전히 같다.** 배치 5 · 동시 2 · 콜 상한 55초.
           바뀌는 건 '같은 콜을 한 회차에 몇 번 하느냐' 뿐이라 새 실패 모양이 없다.
         · 크론 호출 수는 그대로다 (예산 2,598/2,600 을 안 건드린다).
         · 비용: Vercel 은 실제로 돈 시간만 청구한다. 항목당 초는 오히려 준다
           (기동 비용이 더 많은 항목에 나눠지므로). 총 일감은 유한하니 총액은 같고
           끝나는 날짜만 당겨진다. */
    const left = 270000 - (Date.now() - started);
    if (left > 25000) {
      try {
        /* 6 → 18 (2026-09-02). 6 은 "응답이 잘리면 배치 전멸" 이라는 전제로 고른
           값인데, JSONL 로 바꾼 뒤로는 잘려도 완성된 줄이 다 살아남는다.
           MAX_TOKENS 도 16,000 으로 올려 상한이 배치를 묶지 않는다. */
        /* 18 → 8 (2026-09-02, 라이브 실측 후 되돌림). 18 로 키운 콜이 95초 안에
           안 끝났다 — 런타임 로그 'aborted due to timeout' 16건, 429 는 0건.
           batch 6 이 약 30초였으니 8 은 40초 안쪽이고 콜 상한 55초에 든다.
           처리량은 배치가 아니라 파도(회전)로 올린다. */
        /* 8 → 5 (2026-09-03 02:50, 라이브 10시간 실측).
           콜 상한 55초를 못 맞추는 회차가 계속 나온다. 언어별로 갈린다:

             언어  실패  성공        (최근 3시간, 회차당 콜 2개)
             ja     6     1
             de     6     0
             it     5     1
             ru     5     0
             zh     0     4
             fr     0     6
             es     0     6

           **왜 넷만 느린지는 아직 모른다.** 429 는 아니다(로그: aborted due to
           timeout 만 나오고 rate_limit 은 0건). 멀티바이트 가설도 아니다 —
           zh 가 실패 0 이다. 원인을 모르는 채로 상수를 또 찍지 않는다.

           대신 원인과 무관하게 듣는 손잡이를 쓴다: 한 콜의 일감을 줄인다.
           55초를 못 맞추던 콜이 맞출 확률이 올라가고, 맞추던 콜은 조금 빨라진다.

           지금 실적: 회차당 평균 8건 (실패로 절반이 날아간다)
           기대:     실패가 줄면 회차당 10건 (2 x 5) 이상 + 버리는 토큰 감소 */
        i18n = await runEditorialFaqI18nBatch({ batch: 5, timeoutMs: left });
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
