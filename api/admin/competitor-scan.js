/**
 * GET /api/admin/competitor-scan — 경쟁 IG 계정 공개 데이터 수집 (관리자 전용)
 *
 * business_discovery(공개 조회)로 경쟁 매거진 계정의 프로필·최근 게시물
 * 지표를 가져온다. 완전히 공개된 데이터만 사용 (프로페셔널 계정 한정).
 *
 *   ?u=eyesmag,fastpapermag   쉼표 구분 사용자명 (최대 8개)
 *   ?limit=30                 계정당 최근 게시물 수 (기본 30, 최대 50)
 *
 * 반환: 계정별 { profile, media[] } — 분석은 호출자(Claude/운영자)가 수행.
 * 일일 자동 감시는 /api/cron/competitor-watch 참조.
 */

const { requireAdmin } = require('../_lib/auth');
const { discoverAccount } = require('../_lib/igDiscovery');

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(503).json({ error: 'IG env 미설정' });
  }
  const names = String((req.query && req.query.u) || '').split(',')
    .map((s) => s.trim().replace(/^@/, '')).filter(Boolean).slice(0, 8);
  if (!names.length) return res.status(400).json({ error: '?u=계정1,계정2 필요' });
  const limit = parseInt((req.query && req.query.limit) || '30', 10) || 30;

  const out = [];
  for (const n of names) {
    try { out.push(await discoverAccount(n, limit)); }
    catch (e) { out.push({ username: n, error: String(e && e.message || e).slice(0, 200) }); }
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ scanned_at: new Date().toISOString(), accounts: out });
};
