/**
 * PAP Magazine — 데일리 성장 리포트 조회 (관리자 전용)
 * Route: GET /api/growth-report            → 최신 리포트 (audit + feedback)
 *        GET /api/growth-report?date=YYYY-MM-DD → 특정일
 *        GET /api/growth-report?history=1  → 최근 30일 날짜·요약 목록
 *
 * 소비자: /site-analysis 대시보드. AI 전략 피드백은 내부 문서이므로
 * 관리자 인증 필수 (감사 집계 자체는 /api/growth-audit 로 공개돼 있음).
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');
const { requireAdmin } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).end(); }

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    if (req.query.history === '1') {
      const { data, error } = await supabaseAdmin
        .from('growth_reports')
        .select('report_date, created_at, model, audit')
        .order('report_date', { ascending: false })
        .limit(30);
      if (error) throw error;
      // 히스토리는 요약만 (payload 절약)
      const rows = (data || []).map((r) => ({
        report_date: r.report_date,
        created_at: r.created_at,
        model: r.model,
        summary: r.audit && r.audit.summary ? r.audit.summary : null,
      }));
      return res.status(200).json({ data: rows });
    }

    let q = supabaseAdmin.from('growth_reports').select('*');
    if (req.query.date) q = q.eq('report_date', String(req.query.date));
    else q = q.order('report_date', { ascending: false }).limit(1);

    const { data, error } = await q;
    if (error) throw error;
    if (!data || !data.length) return res.status(404).json({ error: '리포트가 아직 없습니다. 첫 크론 실행(매일 07:30) 후 생성됩니다.' });
    return res.status(200).json({ data: data[0] });
  } catch (err) {
    console.error('[growth-report] error:', err);
    return res.status(500).json({ error: 'report fetch failed' });
  }
};
