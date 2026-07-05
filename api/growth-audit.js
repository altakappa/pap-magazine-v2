/**
 * PAP Magazine — 성장 데이터 검증 엔드포인트 (집계 공개 JSON)
 * Route: GET /api/growth-audit
 *
 * 코어 로직은 api/_lib/growthAudit.js — 매일 크론(daily-growth-feedback)과
 * 공유한다. 집계 수치·제목 샘플만 반환하며 개인정보 없음. edge 10분 캐시.
 * 소비자: 주간 성장 위원회(Cowork 스케줄), /site-analysis 대시보드.
 */

const { handleCors } = require('./_lib/cors');
const { runGrowthAudit } = require('./_lib/growthAudit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).end(); }
  try {
    const report = await runGrowthAudit();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json(report);
  } catch (err) {
    console.error('[growth-audit] error:', err);
    return res.status(500).json({ error: 'audit failed' });
  }
};
