/**
 * PAP Magazine — 데일리 성장 분석·개선 피드백 생성 크론
 * Route: /api/cron/daily-growth-feedback  (vercel.json: 매일 07:30 KST = 22:30 UTC)
 *
 * 흐름:
 *   1. _lib/growthAudit.js 정밀 감사 실행 (5개 영역 20여 항목 + 문제 콘텐츠 제목)
 *   2. 전일 리포트를 불러와 "어제 대비 변화"를 계산 가능하게 함께 제공
 *   3. Claude(ANTHROPIC_API_KEY)가 디지털 매거진 성장 컨설턴트 관점의
 *      전문 분석 + 오늘의 개선 우선순위를 마크다운으로 생성
 *   4. growth_reports 에 upsert (하루 1건)
 *
 * 표시: /site-analysis 대시보드. Claude 실패 시에도 감사 스냅샷은 저장
 * (피드백만 결측) — 데이터 연속성이 우선.
 *
 * 수동 트리거: 관리자 토큰으로 POST 도 허용 (대시보드의 '지금 재분석' 버튼).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { requireAdmin } = require('../_lib/auth');
const { runGrowthAudit } = require('../_lib/growthAudit');
const { sendEmail } = require('../_lib/email');
// 2026-07-21 — 마크다운→메일 HTML 변환은 주간 브리핑과 공유하므로 _lib/mdEmail 로 추출됨.
const { briefingEmailHtml, briefingRecipients } = require('../_lib/mdEmail');

const FEEDBACK_SYSTEM = [
  '너는 디지털 매거진 전문 성장 컨설턴트다. PAP 매거진(아트 기반 패션·뷰티·컬쳐, 인스타그램 @pap_magazine 37만 팔로워 중심, 웹사이트 pap-magazine.com, 자매지 페퍼릿 @pepperitmag 14만)의 일일 데이터를 분석해 실행 가능한 개선 피드백을 쓴다.',
  '',
  '입력: 오늘의 감사 JSON (5개 영역: content 콘텐츠 무결성 / cadence 발행 페이스 / engagement 참여 / pipelines 자동화 건강 / audience 오디언스. 각 항목에 value, compare(전주), status, note, items(문제 콘텐츠 제목)). 어제의 감사 JSON이 함께 오면 반드시 전일 대비 변화를 계산해 언급한다.',
  '',
  '출력 형식 (한국어 마크다운, 이 구조 고정):',
  '## 오늘의 진단 요약',
  '(3~4문장. 상태를 한눈에. 어제와 달라진 것 중심.)',
  '## 🚨 즉시 조치',
  '(status가 fail인 항목만. 없으면 "없음". ig_import_freshness fail = IG 토큰 만료 신호, scheduled_overdue fail = 예약발행 크론 이상이라는 도메인 지식을 활용해 원인 추정까지.)',
  '## 영역별 정밀 분석',
  '(5개 영역 각각 2~4문장. 반드시 수치와 항목 id를 인용. items에 있는 실제 콘텐츠 제목을 지목해 "무엇을 고치라"까지. 추세(value vs compare)가 있으면 해석. 데이터가 지지하지 않는 추측 금지.)',
  '## 오늘의 개선 우선순위',
  '(정확히 3개. 각각: **무엇을** — 왜(근거 수치) — 첫 실행 액션 한 줄 — 예상 효과. 어제 피드백과 동일한 권고를 반복해야 한다면 "[연속 N일째]"를 붙여 미조치를 드러낸다.)',
  '## 이번 주 관찰 지표',
  '(다음 데일리에서 주시할 지표 2~3개와 그 이유 한 줄.)',
  '',
  '이벤트 로그 해석 규칙: 각 이벤트의 outcome 필드가 최종 사실이다. outcome에 취소·삭제·중단이 기록된 이벤트(예: 광고 삭제)는 지표 변화의 원인으로 절대 귀속하지 않는다. outcome이 비어 있어도 이벤트-지표 인과는 "가설"로만 제시하고 단정하지 않는다.',
  '',
  '원칙: 데이터에 없는 것을 지어내지 않는다. 하루 변동을 추세로 과대해석하지 않는다. 모든 권고는 도메니코(1인 운영에 가까움)가 오늘 실행 가능한 크기여야 한다. 과장·클리셰 금지, 컨설팅 보고서의 정확성으로.',
].join('\n');

async function generateFeedback(todayAudit, yesterdayAudit, events) {
  if (!process.env.ANTHROPIC_API_KEY) return { feedback: null, model: null, error: 'ANTHROPIC_API_KEY 미설정' };
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const user = [
    '오늘의 감사 JSON:',
    JSON.stringify(todayAudit),
    '',
    yesterdayAudit ? '어제의 감사 JSON (전일 대비 비교용):' : '어제 리포트 없음 (첫 실행).',
    yesterdayAudit ? JSON.stringify(yesterdayAudit) : '',
    // 064: 운영 이벤트 로그 — 지표 변화의 원인 후보 (광고 시작·정책 변경 등).
    // 변화를 설명할 때 이벤트와 날짜를 대조해 인과 가설을 세우게 한다.
    events && events.length ? '\n운영 이벤트 로그 (최근 14일, 원인 가설용):\n' + JSON.stringify(events) : '',
  ].join('\n');
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 3000, system: FEEDBACK_SYSTEM, messages: [{ role: 'user', content: user }] }),
      // 함수 maxDuration 120s (vercel.json 전역) — Claude 에 100s 까지 허용.
      // 주의: functions 에 개별 파일 키를 추가하면 글롭과 충돌해 빌드가
      // 2초 만에 실패한다 (2026-07-06 배포 장애 원인) — 전역 글롭만 사용.
      signal: AbortSignal.timeout(100000),
    });
    if (!resp.ok) throw new Error('Claude ' + resp.status);
    const j = await resp.json();
    const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
    return { feedback: block ? block.text.trim() : null, model, error: null };
  } catch (err) {
    return { feedback: null, model, error: String(err && err.message || err) };
  }
}

module.exports = withCronGuard('daily-growth-feedback', async function handler(req, res) {
  // 크론 Bearer 또는 관리자 (대시보드 수동 재분석)
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  try {
    // 1) 오늘 감사
    const audit = await runGrowthAudit();

    // 2) 직전 리포트 (전일 대비) + 운영 이벤트 로그 (064, 원인 가설용)
    const since14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const [{ data: prevRows }, evQ] = await Promise.all([
      supabaseAdmin.from('growth_reports').select('audit, report_date')
        .order('report_date', { ascending: false }).limit(1),
      supabaseAdmin.from('growth_events')
        .select('event_date, kind, title, expected, outcome')
        .gte('event_date', since14).order('event_date', { ascending: false }).limit(20),
    ]);
    const prev = prevRows && prevRows[0] ? prevRows[0].audit : null;
    const events = (evQ && evQ.data) || [];

    // 3) Claude 분석
    const { feedback, model, error: aiError } = await generateFeedback(audit, prev, events);

    // 4) upsert (KST 기준 오늘 날짜). AI 실패 시 사유를 model 필드에 남겨
    //    대시보드에서 원인이 보이게 한다 (feedback 은 null 유지).
    const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const modelNote = feedback ? model : (model || '') + (aiError ? ' (실패: ' + String(aiError).slice(0, 100) + ')' : '');
    const { error } = await supabaseAdmin.from('growth_reports')
      .upsert({ report_date: kstDate, audit, feedback, model: modelNote }, { onConflict: 'report_date' });
    if (error) throw error;

    // 이메일 발송 (2026-07-21 도메니코 지시로 중단).
    // 처음엔 같은 날 "메일로도 보내달라"였는데, 받아보고 나서 "데일리 성장
    // 브리핑은 이메일로 발송 안 해줘도 괜찮다"로 바꿨다. 리포트는 DB 에
    // 저장되고 /site-analysis 대시보드에서 볼 수 있으므로 정보 손실은 없다.
    // 다시 켜려면 GROWTH_BRIEFING_EMAIL=on.
    let emailed = false;
    if (feedback && process.env.GROWTH_BRIEFING_EMAIL === 'on') {
      try {
        const html = briefingEmailHtml({
          title: '데일리 성장 브리핑',
          dateLabel: kstDate,
          markdown: feedback,
          footerHtml: '자세한 지표는 <a href="https://www.pap-magazine.com/site-analysis" style="color:#2980b9">/site-analysis</a> 대시보드에서',
        });
        const r = await sendEmail(briefingRecipients(), { subject: '[PAP] 데일리 성장 브리핑 — ' + kstDate, html });
        emailed = !!(r && r.sent);
      } catch (e) {
        console.warn('[daily-growth-feedback] email failed:', e && e.message);
      }
    }

    return res.status(200).json({
      ok: true, report_date: kstDate,
      summary: audit.summary,
      feedback_generated: !!feedback,
      emailed,
      ai_error: aiError || undefined,
    });
  } catch (err) {
    console.error('[daily-growth-feedback] error:', err);
    return res.status(500).json({ error: 'daily feedback failed', detail: String(err && err.message || err) });
  }
});
