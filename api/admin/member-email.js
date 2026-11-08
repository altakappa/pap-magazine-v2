/**
 * POST /api/admin/member-email — 회원 한 사람에게 메일 보내기 (관리자)
 *
 * 왜 생겼나 (2026-11-09) — 결제 중복 건으로 회원에게 사과 메일을 보내야 했는데
 * 관리자 화면에 그 수단이 아예 없었다. 도메니코가 Gmail 을 따로 열어 손으로
 * 보내야 했고, 그래서 **어떤 회원에게 뭘 보냈는지 기록이 한 줄도 안 남았다.**
 * 문의 응대·사과·안내는 앞으로도 계속 생긴다. 보내는 자리와 남는 자리를 함께 만든다.
 *
 * Body: { memberId, subject, body }
 *   subject·body 는 **평문**이다. HTML 은 받지 않는다 — 템플릿(templates.adminMessage)이
 *   이스케이프하고 줄바꿈만 살린다. 메일 틀(머리말·꼬리말)은 회원 언어로 맞춰진다.
 *
 * 권한: requireAdmin (대표 관리자 + 스태프).
 *   회원 대면 문구라 조심스럽지만, 문의 응대는 스태프의 일상 업무다. 삭제·강등처럼
 *   되돌릴 수 없는 '회수' 가 아니라 '연락' 이므로 대표 관리자 전용으로 막지 않는다.
 *   대신 **누가 보냈는지 전부 기록한다**(admin_member_emails.sent_by).
 *
 * 기록: admin_member_emails (마이그레이션 182). 발송 실패·발송금지도 함께 적는다 —
 *   "보냈다고 생각했는데 안 갔다" 가 가장 나쁜 결말이다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
const { MAX, cleanText } = require('../_lib/userHtml');

const SUBJECT_MAX = 150;
const BODY_MAX = 5000;

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ message: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { memberId } = req.body || {};
  /* 제목·본문은 평문이다. 제어문자를 털고 길이를 자른다 (_lib/userHtml.js). */
  const subject = cleanText((req.body || {}).subject, SUBJECT_MAX);
  const body = cleanText((req.body || {}).body, BODY_MAX);

  if (!memberId) return res.status(400).json({ message: 'memberId is required', code: 'MEMBER_REQUIRED' });
  if (!subject) return res.status(400).json({ message: 'Subject is required', code: 'SUBJECT_REQUIRED' });
  if (!body) return res.status(400).json({ message: 'Message body is required', code: 'BODY_REQUIRED' });

  let member;
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, name, display_name, language, email_language, country')
      .eq('id', memberId)
      .maybeSingle();
    if (error) throw error;
    member = data;
  } catch (err) {
    console.error('[member-email] 회원 조회 실패:', err && err.message);
    return res.status(500).json({ message: 'Could not load this member. contact@pap-magazine.com', code: 'member_lookup_failed' });
  }
  if (!member) return res.status(404).json({ message: 'Member not found', code: 'MEMBER_NOT_FOUND' });
  if (!member.email) return res.status(400).json({ message: 'This member has no email address', code: 'MEMBER_NO_EMAIL' });

  let lang = 'en';
  try { lang = resolveEmailLang(member) || 'en'; } catch (_) { lang = member.email_language || member.language || 'en'; }

  let result = null;
  let status = 'sent';
  let errText = null;
  try {
    const tpl = templates.adminMessage(member, { subject, body }, lang);
    /* transactional: true — 문의 응대는 홍보가 아니다. 영구 반송 주소에는 어차피
       가지 않고, 스팸 신고 주소에도 '당신의 결제 건' 같은 연락은 닿아야 한다. */
    result = await sendEmail(member.email, tpl, { transactional: true });
    if (result && result.skipped) {
      status = 'skipped';
      errText = result.suppressed ? ('suppressed: ' + result.suppressed) : (result.error || 'skipped');
    }
  } catch (err) {
    status = 'failed';
    errText = (err && err.message) || String(err);
    console.error('[member-email] 발송 실패:', errText);
  }

  /* 기록은 발송 성패와 무관하게 남긴다. 기록이 실패해도 발송 결과는 그대로 돌려준다 —
     장부가 본업을 막으면 안 된다 (cronGuard 와 같은 원칙). */
  try {
    await supabaseAdmin.from('admin_member_emails').insert({
      member_id: member.id,
      to_email: member.email,
      subject,
      body,
      lang,
      sent_by: admin.id,
      status,
      error: errText ? String(errText).slice(0, 500) : null,
    });
  } catch (logErr) {
    console.error('[member-email] 기록 실패(발송은 위 결과대로):', logErr && logErr.message);
  }

  if (status === 'sent') {
    return res.status(200).json({ sent: true, to: member.email, lang });
  }
  return res.status(200).json({
    sent: false,
    status,
    to: member.email,
    reason: errText || null,
    message: status === 'skipped'
      ? 'This address is on the suppression list (bounce or spam complaint), so nothing was sent.'
      : 'Sending failed. Please try again or contact contact@pap-magazine.com',
    code: status === 'skipped' ? 'EMAIL_SUPPRESSED' : 'EMAIL_SEND_FAILED',
  });
};
