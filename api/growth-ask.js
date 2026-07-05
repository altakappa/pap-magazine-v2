/**
 * PAP Magazine — "AI에게 질문" (관리자 대시보드 자연어 데이터 분석)
 * Route: POST /api/growth-ask  { question: "..." }   (관리자 전용)
 *
 * 최신 데일리 진단 + 직전 7개 리포트 요약을 컨텍스트로 Claude 가
 * 데이터 분석가로서 답한다. 데이터에 없는 것은 없다고 말하도록 강제.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');
const { requireAdmin } = require('./_lib/auth');
const { rateLimit, RATE_LIMITS } = require('./_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return res.status(405).end(); }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 미설정' });

  const question = String((req.body && req.body.question) || '').trim().slice(0, 500);
  if (!question) return res.status(400).json({ error: '질문이 비어 있습니다' });

  try {
    // 064: 이벤트 원장·주간 브리핑·트렌드까지 컨텍스트에 포함 (인과 가설·전략 질문 대응)
    const [{ data }, evQ, wbQ, trQ] = await Promise.all([
      supabaseAdmin.from('growth_reports')
        .select('report_date, audit, feedback')
        .order('report_date', { ascending: false }).limit(8),
      supabaseAdmin.from('growth_events')
        .select('event_date, kind, title, expected, review_date, outcome')
        .order('event_date', { ascending: false }).limit(20),
      supabaseAdmin.from('weekly_briefings')
        .select('week_start, briefing')
        .order('week_start', { ascending: false }).limit(1),
      supabaseAdmin.from('trend_reports')
        .select('report_date, items')
        .order('report_date', { ascending: false }).limit(1),
    ]);
    const rows = data || [];
    if (!rows.length) return res.status(404).json({ error: '아직 리포트가 없습니다' });

    const latest = rows[0];
    const history = rows.slice(1).map((r) => ({ date: r.report_date, summary: r.audit && r.audit.summary }));
    const events = (evQ && evQ.data) || [];
    const weekly = wbQ && wbQ.data && wbQ.data[0] ? String(wbQ.data[0].briefing || '').slice(0, 1200) : '';
    const trends = trQ && trQ.data && trQ.data[0] ? (trQ.data[0].items || []).slice(0, 6) : [];

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        max_tokens: 800,
        system: 'PAP 매거진(인스타그램 중심 패션·뷰티·컬쳐 매거진)의 데이터 분석가. 제공된 감사 JSON·이벤트 로그·주간 브리핑·트렌드만을 근거로 한국어로 간결하게 답한다(5문장 이내, 필요시 수치·항목 id 인용). 지표 변화의 원인을 물으면 이벤트 로그와 날짜를 대조해 가설을 세우되 "이벤트 로그 기준"임을 밝힌다. 데이터에 없는 것은 "이 데이터로는 알 수 없다"고 말하고 추측하지 않는다. 실행 제안은 마지막 한 문장으로.',
        messages: [{ role: 'user', content: '오늘 감사: ' + JSON.stringify(latest.audit) + '\n지난 요약: ' + JSON.stringify(history) + '\n운영 이벤트 로그: ' + JSON.stringify(events) + (weekly ? '\n최근 주간 브리핑: ' + weekly : '') + (trends.length ? '\n최근 트렌드 스카우트: ' + JSON.stringify(trends) : '') + '\n오늘 AI 피드백: ' + String(latest.feedback || '').slice(0, 1500) + '\n\n질문: ' + question }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) throw new Error('Claude ' + resp.status);
    const j = await resp.json();
    const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
    return res.status(200).json({ answer: block ? block.text.trim() : '(응답 없음)', report_date: latest.report_date });
  } catch (err) {
    console.error('[growth-ask] error:', err);
    return res.status(500).json({ error: 'ask failed', detail: String(err && err.message || err).slice(0, 120) });
  }
};
