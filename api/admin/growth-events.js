/**
 * PAP Magazine — 이벤트·결정 원장 (관리자 전용)
 * Route: GET  /api/admin/growth-events            → 최근 60일 이벤트 + 검증 기한 지난 결정
 *        POST /api/admin/growth-events            → 기록 { kind, title, detail, expected, review_date }
 *        POST /api/admin/growth-events?outcome=1  → 결정 검증 { id, outcome }
 *
 * 용도 (guide/AUTOMATION_PROMPTS_ADVANCED.md 13·02):
 *   - 지표 변화의 원인 후보를 AI 분석 컨텍스트에 공급 (daily feedback / growth-ask)
 *   - 운영 결정을 '예상 결과 + 검증 시점'과 함께 기록하고, 기한이 지나면
 *     due 목록으로 부상시켜 "예상대로 됐나"를 강제로 되묻는다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const [{ data: events, error: e1 }, { data: due, error: e2 }] = await Promise.all([
        supabaseAdmin.from('growth_events').select('*')
          .gte('event_date', since).order('event_date', { ascending: false }).limit(100),
        supabaseAdmin.from('growth_events').select('*')
          .eq('kind', 'decision').is('outcome', null).lte('review_date', today)
          .order('review_date', { ascending: true }).limit(20),
      ]);
      if (e1 || e2) throw (e1 || e2);
      return res.status(200).json({ events: events || [], review_due: due || [] });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      // 검증 기록 모드
      if (req.query.outcome === '1') {
        const id = String(b.id || '');
        const outcome = String(b.outcome || '').trim().slice(0, 2000);
        if (!id || !outcome) return res.status(400).json({ error: 'id와 outcome이 필요합니다' });
        const { error } = await supabaseAdmin.from('growth_events').update({ outcome }).eq('id', id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }
      // 신규 기록
      const title = String(b.title || '').trim().slice(0, 300);
      if (!title) return res.status(400).json({ error: 'title이 필요합니다' });
      const kind = ['event', 'decision', 'experiment'].includes(b.kind) ? b.kind : 'event';
      const row = {
        kind, title,
        detail: b.detail ? String(b.detail).slice(0, 2000) : null,
        expected: b.expected ? String(b.expected).slice(0, 1000) : null,
        review_date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.review_date || '')) ? b.review_date : null,
        event_date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.event_date || ''))
          ? b.event_date
          : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10),
      };
      const { data, error } = await supabaseAdmin.from('growth_events').insert(row).select().single();
      if (error) throw error;
      return res.status(201).json({ ok: true, event: data });
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).end();
  } catch (err) {
    console.error('[growth-events] error:', err);
    return res.status(500).json({ error: 'growth events failed', detail: String(err && err.message || err).slice(0, 120) });
  }
};
