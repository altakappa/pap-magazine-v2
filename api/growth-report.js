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
    // 추세 레이더 (2026-07) — 저장된 데일리 스냅샷을 시계열로 변환해
    // 핵심 지표별 [값 배열, 선형회귀 기울기(일당 변화), 최신값의 z-score]를
    // 계산한다. |z| >= 2 는 이상 신호. 데이터가 3일 미만이면 수집 중 표시.
    if (req.query.trends === '1') {
      const { data, error } = await supabaseAdmin
        .from('growth_reports').select('report_date, audit')
        .order('report_date', { ascending: true }).limit(30);
      if (error) throw error;
      const KEYS = [
        ['views_last7', '조회(7일)'], ['signups_last7', '가입(7일)'],
        ['editorials_pace', '에디토리얼 발행'], ['articles_pace', '기사 발행'],
        ['comments_last7', '댓글(7일)'], ['community_scraps_last7', '스크랩(7일)'],
        ['pinterest_backlog', 'Pinterest 잔량'], ['editorials_missing_description_en', 'EN설명 누락'],
      ];
      const rows = data || [];
      const trends = KEYS.map(([id, label]) => {
        const series = rows.map((r) => {
          const all = Object.values((r.audit && r.audit.sections) || {}).flat();
          const c = all.find((x) => x.id === id);
          return { d: r.report_date, v: c && typeof c.value === 'number' ? c.value : null };
        }).filter((p) => p.v !== null);
        const vs = series.map((p) => p.v);
        const n = vs.length;
        if (n < 3) return { id, label, points: series, status: 'collecting', note: `데이터 수집 중 (${n}/3일)` };
        const mean = vs.reduce((a, b) => a + b, 0) / n;
        const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
        const xs = vs.map((_, i) => i);
        const xm = (n - 1) / 2;
        const slope = xs.reduce((a, x, i) => a + (x - xm) * (vs[i] - mean), 0)
                    / xs.reduce((a, x) => a + (x - xm) ** 2, 0);
        const z = (vs[n - 1] - mean) / sd;
        const forecast7 = Math.max(0, Math.round(vs[n - 1] + slope * 7));
        return {
          id, label, points: series.slice(-14),
          slope: Math.round(slope * 100) / 100, z: Math.round(z * 100) / 100,
          forecast7, anomaly: Math.abs(z) >= 2,
          status: Math.abs(z) >= 2 ? 'anomaly' : slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat',
        };
      });
      return res.status(200).json({ days: rows.length, trends });
    }

    // 최신 주간 경영 브리핑 (064 weekly_briefings)
    if (req.query.weekly === '1') {
      const { data, error } = await supabaseAdmin
        .from('weekly_briefings').select('*')
        .order('week_start', { ascending: false }).limit(1);
      if (error) throw error;
      if (!data || !data.length) return res.status(404).json({ error: '주간 브리핑이 아직 없습니다. 매주 월 07:30 KST 생성됩니다.' });
      return res.status(200).json({ data: data[0] });
    }

    // 최신 트렌드 스카우트 (064 trend_reports)
    if (req.query.trendscout === '1') {
      const { data, error } = await supabaseAdmin
        .from('trend_reports').select('*')
        .order('report_date', { ascending: false }).limit(1);
      if (error) throw error;
      if (!data || !data.length) return res.status(404).json({ error: '트렌드 리포트가 아직 없습니다. 화·금 06:00 KST 생성됩니다.' });
      return res.status(200).json({ data: data[0] });
    }

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
