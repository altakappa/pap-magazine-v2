/**
 * POST /api/submissions/:id/feedback-request — 심사 피드백 신청 (도메니코 2026-09-12)
 *
 * "프리미엄이 아니었던 사람이 업그레이드하고 피드백 신청을 누르면 내가 써주는 형식. 굳이 피드백을 보지
 *  않는 일반 회원에게까지 미리 써줄 필요는 없으니까."
 * → 피드백은 회원이 **신청**했을 때 도메니코가 쓴다. 신청 자격은 /subscribe 문구대로 스탠다드 이상.
 *   신청하면 description.feedbackRequestedAt 을 찍고 텔레그램으로 알린다. 도메니코가 관리자에서 메모를
 *   쓰면 마이페이지 "에디터 피드백" 에 그대로 뜬다(admin_notes). 같은 건은 한 번만 신청된다.
 *
 * 자격: 본인 + 스탠다드 이상 + status ∈ rejected/approved/published + 아직 실제 피드백이 없음
 *       (admin_notes 비었거나 자동 반려문(DEFAULT_REJECTION_NOTE) 그대로).
 */
'use strict';
const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { requireAuth } = require('../../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { loadPlan, canSeeFeedback, hasRealFeedback, FEEDBACK_REQUESTABLE_STATUSES } = require('../../_lib/submissionFeedbackGate');
const { sendTextToTelegramSafe } = require('../../_lib/telegram');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const user = requireAuth(req, res);
  if (!user) return;
  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ message: 'Missing submission id' });

  try {
    const { data: sub, error } = await supabaseAdmin
      .from('submissions').select('id, user_id, title, status, admin_notes, description').eq('id', id).single();
    if (error || !sub) return res.status(404).json({ message: 'Submission not found' });
    if (sub.user_id !== user.id) return res.status(403).json({ message: 'Only the submitter can request feedback' });

    const plan = await loadPlan(supabaseAdmin, user.id);
    if (!canSeeFeedback(plan)) {
      return res.status(403).json({ code: 'FEEDBACK_STANDARD_ONLY', message: 'Review feedback is available from the Standard plan', requiresPlan: 'standard' });
    }
    if (FEEDBACK_REQUESTABLE_STATUSES.indexOf(sub.status) === -1) {
      return res.status(409).json({ code: 'FEEDBACK_NOT_APPLICABLE', message: 'Feedback can be requested only after a review decision (status: ' + sub.status + ')' });
    }
    if (hasRealFeedback(sub.admin_notes)) {
      return res.status(409).json({ code: 'FEEDBACK_ALREADY_WRITTEN', message: 'Feedback is already available for this submission' });
    }
    let desc = {};
    try { desc = sub.description ? JSON.parse(sub.description) : {}; } catch (_) { desc = {}; }
    if (desc.feedbackRequestedAt) {
      return res.status(200).json({ ok: true, already: true, feedbackRequestedAt: desc.feedbackRequestedAt });
    }
    desc.feedbackRequestedAt = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin
      .from('submissions').update({ description: JSON.stringify(desc) }).eq('id', id);
    if (upErr) throw upErr;

    // ★ await — serverless 는 응답 후 얼어붙는다.
    const planName = String((plan && plan.subscription_plan) || 'free').toUpperCase();
    await sendTextToTelegramSafe(
      '💬 서브미션 피드백 신청 (' + planName + ')\n'
      + '작품: ' + String(sub.title || sub.id).slice(0, 80) + ' · 상태: ' + sub.status + '\n'
      + '회원: ' + (user.email || user.id) + '\n'
      + '관리자에서 검토 메모(피드백)를 쓰면 마이페이지에 바로 보입니다: https://www.pap-magazine.com/admin\n'
      + 'submission=' + sub.id
    );
    return res.status(200).json({ ok: true, feedbackRequestedAt: desc.feedbackRequestedAt });
  } catch (err) {
    console.error('[feedback-request] error', err);
    return res.status(500).json({ message: 'Failed to request feedback' });
  }
};
