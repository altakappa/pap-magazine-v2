/**
 * PAP Magazine — 주간 경영 브리핑 크론 (guide/AUTOMATION_PROMPTS_ADVANCED.md 06)
 * Route: /api/cron/weekly-briefing  (vercel.json: 매주 월 07:30 KST = 일 22:30 UTC)
 *
 * 데일리 진단(growth_reports)이 "오늘 뭐가 문제인가"라면,
 * 주간 브리핑은 "이번 주는 어떤 한 주였고 다음 주엔 무엇에 베팅하나"의 서사.
 *
 * 흐름:
 *   1. 지난 7일 growth_reports + 그 전 7일 (전주 비교)
 *   2. growth_events (지난 14일 이벤트 + 검증 기한 도래 결정)
 *   3. affiliate_clicks 주간 집계 (수익 신호)
 *   4. Claude 가 '한 문장 → 잘된 것 2/안된 것 2 → 원인 → 다음 주 베팅 1개
 *      → 대표 결정 요청(예/아니오 질문 최대 3개)' 구조로 생성
 *   5. weekly_briefings upsert (week_start 기준 주 1건)
 *
 * 수동 트리거: 관리자 토큰 POST 허용.
 */

const { reportAiResponse } = require('../_lib/aiCreditWatch');   // AI 장애 알림 (2026-07-30)
const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { requireAdmin } = require('../_lib/auth');
const { sendEmail } = require('../_lib/email');
const { briefingEmailHtml, briefingRecipients } = require('../_lib/mdEmail');

const SYSTEM = [
  '너는 PAP 매거진(아트 기반 패션·뷰티·컬쳐 디지털 매거진, IG @pap_magazine 38만, 웹 pap-magazine.com, 자매지 페퍼릿 @pepperitmag 14만 — 두 매체 지표는 절대 합산 금지)의 주간 경영 브리핑을 쓰는 전략 컨설턴트다.',
  '입력: 지난 7일 데일리 감사 요약 배열, 전주 7일 요약 배열, 운영 이벤트 로그, 어필리에이트 클릭 수.',
  '',
  '출력 (한국어 마크다운, 구조 고정):',
  '# 주간 브리핑 — {week_start} 주',
  '## 이번 주의 한 문장',
  '(이번 주를 정의하는 단 한 문장.)',
  '## 잘된 것 2 / 안된 것 2',
  '(각각 수치 근거 필수. 전주 대비 변화율 계산해 인용.)',
  '## 원인 분석',
  '(지표 변화를 이벤트 로그와 대조해 가장 유력한 원인 가설을 랭킹. 이벤트 로그에 없는 원인은 "미기록 요인 가능성"으로 표시.)',
  '## 다음 주의 베팅 1개',
  '(리소스를 집중할 단 하나. 무엇을 — 왜 지금 — 성공 판정 기준(수치)까지.)',
  '## 대표 결정 요청',
  '(도메니코가 예/아니오로 답할 수 있는 질문 최대 3개. 없으면 "없음". 검증 기한이 지난 과거 결정이 입력에 있으면 반드시 1번 질문으로 회수한다.)',
  '',
  '원칙: 숫자는 근거로만, 서사가 주인공. 데이터에 없는 것은 지어내지 않는다. 1인 운영 규모에 맞는 실행 크기.',
].join('\n');

function kstDate(offsetDays) {
  return new Date(Date.now() + 9 * 3600 * 1000 - (offsetDays || 0) * 86400000).toISOString().slice(0, 10);
}

module.exports = withCronGuard('weekly-briefing', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 미설정' });

  try {
    const today = kstDate(0);
    const d7 = kstDate(7);
    const d14 = kstDate(14);
    // 이번 주 월요일 (KST) — 실행 시점이 월요일이므로 오늘이 곧 week_start
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const dow = now.getUTCDay(); // KST 보정된 요일
    const weekStart = kstDate(dow === 0 ? 6 : dow - 1);

    const [reports, events, clicks] = await Promise.all([
      supabaseAdmin.from('growth_reports').select('report_date, audit')
        .gte('report_date', d14).order('report_date', { ascending: true }).limit(20),
      supabaseAdmin.from('growth_events').select('event_date, kind, title, detail, expected, review_date, outcome')
        .gte('event_date', d14).order('event_date', { ascending: true }).limit(50),
      supabaseAdmin.from('affiliate_clicks').select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);

    const rows = reports.data || [];
    const thisWeek = rows.filter((r) => r.report_date >= d7).map((r) => ({ d: r.report_date, s: r.audit && r.audit.summary }));
    const lastWeek = rows.filter((r) => r.report_date < d7).map((r) => ({ d: r.report_date, s: r.audit && r.audit.summary }));
    const evs = events.data || [];
    const dueDecisions = evs.filter((e) => e.kind === 'decision' && !e.outcome && e.review_date && e.review_date <= today);

    const userMsg = [
      'week_start: ' + weekStart,
      '이번 주 데일리 요약(' + thisWeek.length + '일):', JSON.stringify(thisWeek),
      '전주 데일리 요약(' + lastWeek.length + '일):', JSON.stringify(lastWeek),
      '운영 이벤트 로그(14일):', JSON.stringify(evs),
      '검증 기한 도래한 미검증 결정:', JSON.stringify(dueDecisions),
      '어필리에이트 클릭(7일): ' + (clicks.count || 0),
    ].join('\n');

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
    let briefing = null;
    let aiError = null;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 2500, system: SYSTEM, messages: [{ role: 'user', content: userMsg }] }),
        signal: AbortSignal.timeout(100000), // maxDuration 120s (전역 글롭 — 개별 functions 키 금지)
      });
      if (!resp.ok) { await reportAiResponse(resp, 'weekly-briefing'); throw new Error('Claude ' + resp.status); }
      const j = await resp.json();
      const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
      briefing = block ? block.text.trim() : null;
    } catch (err) {
      aiError = String(err && err.message || err);
    }

    const metrics = {
      daily_reports: thisWeek.length,
      affiliate_clicks_7d: clicks.count || 0,
      events_14d: evs.length,
      decisions_due: dueDecisions.length,
    };
    const { error } = await supabaseAdmin.from('weekly_briefings').upsert({
      week_start: weekStart, briefing, metrics,
      model: briefing ? model : (model + (aiError ? ' (실패: ' + aiError.slice(0, 100) + ')' : '')),
    }, { onConflict: 'week_start' });
    if (error) throw error;

    // 2026-07-21 (도메니코 지시) — 주간 브리핑도 이메일 발송.
    // 기존엔 weekly_briefings 저장만 해서 대시보드를 열어봐야 했다. 데일리와
    // 동일 수신자(DIGEST_TO)에게 월요일 아침 메일로 도착시킨다. 이로써 맥 앱이
    // 꺼져 있어도 주간 브리핑이 전달된다(Cowork 예약 의존 제거).
    // 발송 실패는 삼킨다 — 저장(핵심)은 이미 끝났으므로 크론을 실패로 만들지 않는다.
    let emailed = false;
    if (briefing) {
      try {
        const html = briefingEmailHtml({
          title: '주간 브리핑',
          dateLabel: weekStart + ' 주',
          markdown: briefing,
          footerHtml: '지표 상세는 <a href="https://www.pap-magazine.com/site-analysis" style="color:#2980b9">/site-analysis</a> 대시보드에서',
        });
        const r = await sendEmail(briefingRecipients(), { subject: '[PAP] 주간 브리핑 — ' + weekStart + ' 주', html });
        emailed = !!(r && r.sent);
      } catch (e) {
        console.warn('[weekly-briefing] email failed:', e && e.message);
      }
    }

    return res.status(200).json({ ok: true, week_start: weekStart, briefing_generated: !!briefing, emailed, ai_error: aiError || undefined });
  } catch (err) {
    console.error('[weekly-briefing] error:', err);
    return res.status(500).json({ error: 'weekly briefing failed', detail: String(err && err.message || err).slice(0, 150) });
  }
});
