/**
 * PAP Magazine — 다국어 SEO 번역 백필 (관리자 수동 트리거)
 * Route: GET /api/admin/backfill-translations?lang=it|fr|es|ja&batch=10
 *
 * 실제 처리 로직은 `api/_lib/seoTranslateBackfill.js` 에 있다 (크론과 공용).
 * 이 파일은 "관리자 인증 + 쿼리 파싱 + 응답" 만 담당하는 얇은 진입점이다.
 *
 * 사용 (관리자 로그인 상태에서, 배포 후):
 *   GET /api/admin/backfill-translations?lang=it            → 10건 번역·저장
 *   GET /api/admin/backfill-translations?lang=it&batch=20   → 배치 크기 조절 (1~20)
 *   응답의 remaining 이 0이 될 때까지 반복 호출.
 *
 * 참고: 잔량 대량 소진은 손으로 반복 호출하지 말고
 *       크론(`/api/cron/backfill-translations`, 10분 주기)이 자동으로 처리한다.
 *       이 엔드포인트는 즉시 확인·수동 개입용.
 *
 * 필요 환경변수: ANTHROPIC_API_KEY
 */

const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { runBackfillBatch } = require('../_lib/seoTranslateBackfill');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).end(); }

  const user = await requireAdmin(req, res);
  if (!user) return;

  const lang = String(req.query.lang || '').toLowerCase();
  const batch = req.query.batch;
  /* 2026-07-21 — kind 추가(editorial 기본). 아티클 본문 번역을 수동으로
     돌릴 수 있어야 한다. 예: ?lang=ja&kind=article&batch=3 */
  const kind = String(req.query.kind || 'editorial').toLowerCase();

  /* ─── 2026-08-08 — 이 경로에도 마감을 준다 ────────────────────────────
   *
   * 왜 필요해졌나: 이 엔드포인트는 **크론이 6,000자 상한으로 제외한 긴 글**을
   * 처리하는 유일한 통로다(_lib 의 maxSrcChars 주석 참고. 지금 6건 · 번역
   * 25개가 여기에 걸려 있다). 그런데 여태 deadlineAt 을 안 넘겨서 마감이
   * Infinity 였다 — 호출 타임아웃 90초짜리가 배치 호출 + 단건 재시도로
   * 두 번 돌면 180초라 **함수 상한 120초를 넘겨 죽는다.** 죽으면 응답이
   * 없어 화면은 그냥 '실패'로 보이고, 무슨 일이 있었는지 알 수 없다.
   *
   * 100초를 주면 이 파일의 모든 경로가 그 안에서 스스로 접고(canCall),
   * 못 끝낸 건 `ran_out_of_time: true` 로 보고한 뒤 200 으로 나간다.
   * 화면은 그걸 보고 다시 부르면 된다 — 크론과 같은 규약이다.
   *
   * timeout 은 쿼리로 조절할 수 있게 둔다. 긴 글은 한 건이 60~90초라
   * 기본값으로 충분하지만, 12,963자 같은 최상단 건에는 여유가 필요하다. */
  const ADMIN_BUDGET_MS = 100000;
  const timeoutMs = (() => {
    const n = Number(req.query.timeout);
    return Number.isFinite(n) && n > 0 ? Math.max(10000, Math.min(90000, n)) : 90000;
  })();

  try {
    const result = await runBackfillBatch({
      lang, kind, batch, timeoutMs,
      deadlineAt: Date.now() + ADMIN_BUDGET_MS,
      /* 길이 상한 없음(0) — 이 경로의 존재 이유가 '크론이 뺀 긴 글' 이다.
         명시적으로 적어 둔다: 기본값에 기대면 나중에 기본값이 바뀔 때 조용히
         깨진다. */
      maxSrcChars: 0,
    });
    return res.status(200).json(result);
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 500;
    if (code !== 500) {
      return res.status(code).json({ error: String(err.message || err) });
    }
    console.error('[backfill-translations] error:', err);
    return res.status(500).json({
      error: 'translation backfill failed',
      detail: String(err && err.message || err).slice(0, 300),
    });
  }
};
