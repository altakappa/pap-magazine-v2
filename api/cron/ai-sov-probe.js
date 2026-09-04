/**
 * PAP Magazine — AI 답변 점유율(SoV) 프로브 크론 (2026-08-28 신설)
 * Route: /api/cron/ai-sov-probe   (vercel.json: 매주 월 07:05 KST = 일 22:05 UTC)
 *
 * 왜 주 1회인가 — 두 가지 제약이 같은 답을 가리킨다.
 *   ① 크론 호출 예산이 2,598/2,600 이다(vercel-cost-guard). 남은 자리가 2 다.
 *      주간 크론은 하루 환산 0.14회라 이 틈에 들어간다. 일간이면 못 넣는다.
 *   ② 교재 8장이 권하는 주기가 월 1회다. 답변은 확률적이라 자주 재도 노이즈만
 *      늘고, 우리가 콘텐츠를 바꾸는 속도(주 단위)보다 빨리 재면 학습이 아니라
 *      도박이다(GROWTH-LEDGER 교훈 5).
 *
 * 왜 주간 브리핑 안에서 안 돌리나 — **수집과 보고를 분리한다.**
 * 프로브는 32콜(질문 8 × 엔진 2 × 모드 2)이고 웹검색 모드는 콜당 10~30초다.
 * 브리핑 함수(120초) 안에 넣으면 브리핑이 프로브에 인질로 잡힌다. 프로브는
 * 여기서 DB 에 쌓고, 브리핑은 그 표를 **읽기만** 한다(싸고 안 죽는다).
 * 그래서 이 크론은 브리핑(22:45 UTC)보다 40분 먼저 돈다.
 *
 * 실패해도 조용히 죽지 않는다: 조합마다 행을 남기고(실패는 error 기입),
 * cron_runs.note 에 생산량을 적는다 — '돌았다 ≠ 했다' 를 또 겪지 않기 위해.
 */

const { bearerOk } = require('../_lib/secretCompare');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { runSovProbe } = require('../_lib/aiVisibility');

module.exports = withCronGuard('ai-sov-probe', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  try {
    /* maxDuration 300 (vercel.json 개별 키). 240 → 270 (2026-08-30 실측):
       웹검색 콜이 느려 마지막 웨이브가 예산에 걸렸다. 여유 30초는 남긴다. */
    const out = await runSovProbe({ timeoutMs: 270000 });
    res.locals.cronNote = out.note;
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 500;
    console.error('[ai-sov-probe]', (err && err.message) || err);
    res.locals.cronNote = 'SoV 실패 — ' + String((err && err.message) || 'failed').slice(0, 120);
    return res.status(code).json({ ok: false, error: (err && err.message) || 'failed' });
  }
});
