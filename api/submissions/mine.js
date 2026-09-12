/**
 * GET /api/submissions/mine — Get current user's submissions
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { loadPlan, shapeForOwner } = require('../_lib/submissionFeedbackGate');   // 2026-09-12 피드백=스탠다드+, 대기 중 수정=프리미엄
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { data: submissions, error } = await supabaseAdmin
      .from('submissions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // QA(2026-07-22, 마이페이지 세부 상태) — 관리자 목록과 동일하게 연결 에디토리얼을
    // hydrate 한다. 마이페이지가 '업로드 완료'(approved + published editorial) 판정과
    // "게시물 보러가기" 링크(slug)를 만들 수 있게 하기 위함. 관리자(index.js)와 같은
    // source_submission_id 매칭 + published 우선 규칙(QA #290)을 그대로 따른다.
    const subIds = (submissions || []).map(s => s.id).filter(Boolean);
    const linkedBySubId = {};
    if (subIds.length > 0) {
      const { data: editorialRows } = await supabaseAdmin
        .from('editorials')
        .select('id, slug, status, published_date, scheduled_publish_at, source_submission_id')
        .in('source_submission_id', subIds);
      if (Array.isArray(editorialRows)) {
        for (const er of editorialRows) {
          if (!er || !er.source_submission_id) continue;
          const existing = linkedBySubId[er.source_submission_id];
          if (!existing) {
            linkedBySubId[er.source_submission_id] = er;
          } else if (er.status === 'published' && existing.status !== 'published') {
            linkedBySubId[er.source_submission_id] = er;
          }
        }
      }
    }
    // 2026-09-12 — 등급 혜택 게이트: 무료 회원에겐 심사 피드백 본문을 비우고(feedbackLocked),
    // 대기 중 자기 수정 가능 여부(canSelfEdit)는 서버가 계산해 내려준다(프론트가 등급을 판단하지 않는다).
    const _plan = await loadPlan(supabaseAdmin, user.id);
    const hydrated = (submissions || []).map(s => ({
      ...shapeForOwner(s, _plan),
      linked_editorial: linkedBySubId[s.id] || null,
    }));

    return res.status(200).json({ submissions: hydrated });
  } catch (error) {
    console.error('Get my submissions error:', error);
    return res.status(500).json({ message: 'Failed to fetch submissions' });
  }
};
