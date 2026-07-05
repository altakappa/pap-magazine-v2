/**
 * PAP Magazine — 투고 AI 1차 심사 (guide/AUTOMATION_PROMPTS_ADVANCED.md 15)
 * Route: POST /api/admin/submissions/:id/triage   (관리자 전용, 저장 없음 — 판단 보조)
 *
 * 크리에이티브팀 에디토리얼 투고를 어드민이 열람할 때 호출:
 *   1. 완결성 체크리스트 — 크레딧·컨셉·파일·연락처 누락 검출
 *   2. 아카이브 적합도 — 최근 발행 화보와 무드 겹침/채워지는 갭 판정
 *   3. 답장 초안 2종 — 보완 요청용 / 반려+커뮤니티 초대용 (발송은 사람)
 *
 * 결과는 반환만 하고 DB에 쓰지 않는다 — 최종 판단·기록은 기존 review 플로우.
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { handleCors } = require('../../../_lib/cors');
const { requireAdmin } = require('../../../_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return res.status(405).end(); }
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 미설정' });

  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: 'submission id 필요' });

  try {
    const [{ data: sub, error: e1 }, { data: recent }] = await Promise.all([
      supabaseAdmin.from('submissions').select('*').eq('id', id).single(),
      supabaseAdmin.from('editorials').select('title, published_date')
        .eq('status', 'published').order('published_date', { ascending: false }).limit(30),
    ]);
    if (e1 || !sub) return res.status(404).json({ error: '투고를 찾을 수 없습니다' });

    // 파일 원본 대신 메타만 전달 (프라이버시·토큰 절약)
    const subMeta = { ...sub };
    if (Array.isArray(subMeta.file_urls)) subMeta.file_urls = subMeta.file_urls.length + '개 파일 첨부';

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 2000,
        system: [
          'PAP 매거진 투고 1차 심사관. 전세계 크리에이티브팀의 에디토리얼 투고를 검토한다.',
          'JSON만 출력 (다른 텍스트 금지):',
          '{',
          ' "checklist": [{"item":"항목","ok":true/false,"note":"한 줄"}],  // 크레딧 완결성·컨셉 설명·파일·연락 수단 등 5~7개',
          ' "fit": {"score":0-10, "overlap":"최근 화보와 무드 겹침 평가 한 줄", "gap":"우리 아카이브에서 채워주는 갭 한 줄"},',
          ' "draft_supplement": "보완 요청 답장 초안 (영어, 정중, 부족 항목 명시, 3~5문장)",',
          ' "draft_decline": "반려 답장 초안 (영어, 정중, PAP 커뮤니티 참여 초대 포함, 3~5문장)"',
          '}',
          '원칙: 절대 승인/반려를 단정하지 않는다 — 판단 재료만. 초안에 발행 확약·일정 확정 문구 금지.',
        ].join('\n'),
        messages: [{
          role: 'user',
          content: '투고 데이터:\n' + JSON.stringify(subMeta).slice(0, 8000)
            + '\n\n최근 발행 화보 제목 30개 (겹침 판정용):\n' + JSON.stringify((recent || []).map((r) => r.title)),
        }],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!resp.ok) throw new Error('Claude ' + resp.status);
    const j = await resp.json();
    const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
    let triage = null;
    try {
      const m = block ? block.text.match(/\{[\s\S]*\}/) : null;
      triage = m ? JSON.parse(m[0]) : null;
    } catch (_) { /* fallthrough */ }
    if (!triage) return res.status(502).json({ error: 'AI 응답 파싱 실패' });

    return res.status(200).json({ ok: true, submission_id: id, triage });
  } catch (err) {
    console.error('[submission-triage] error:', err);
    return res.status(500).json({ error: 'triage failed', detail: String(err && err.message || err).slice(0, 120) });
  }
};
