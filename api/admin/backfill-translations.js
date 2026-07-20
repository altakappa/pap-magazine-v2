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

  try {
    const result = await runBackfillBatch({ lang, batch });
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
