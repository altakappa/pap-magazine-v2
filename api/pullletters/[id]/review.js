/**
 * PUT /api/pullletters/:id/review — Admin review a pull-letter
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { sendEmail, templates } = require('../../_lib/email');
const { resolveEmailLang } = require('../../_lib/emailLocale');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const { id } = req.query;
    const { status, reviewNote, pullLetterPath } = req.body;

    // 'issued' added for the community-flow PDF deliverable. Existing
    // 'accepted'/'rejected' still work for legacy multipart requests.
    // 2026-08-03 — 'on_hold'(무료체험 중 접수 보류)와 'pending'(보류 해제 후
    // 정상 검토 대기)을 추가. 서버가 자동으로 넣은 보류를 첫 결제 확인 뒤
    // 관리자가 되돌릴 수 있어야 한다.
    if (!status || !['pending', 'on_hold', 'accepted', 'approved', 'rejected', 'issued'].includes(status)) {
      return res.status(400).json({ message: 'Status must be one of: pending, on_hold, accepted, approved, rejected, issued' });
    }

    const update = {
      status,
      admin_notes: reviewNote || '',
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    };
    // A-4 (2026-07-26 감사) — 발급 PDF 경로 위조 방지. upload.js 가 만드는
    // '<uid>/<파일>.pdf' 형식(폴더 1단계 + .pdf, 경로 이탈 금지)만 허용.
    var _plPath = null;
    if (typeof pullLetterPath === 'string' && pullLetterPath) {
      if (pullLetterPath.indexOf('..') === -1 && /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.pdf$/i.test(pullLetterPath)) {
        _plPath = pullLetterPath;
      } else {
        return res.status(400).json({ message: 'Invalid pullLetterPath', code: 'invalid_path' });
      }
    }
    if (status === 'issued') {
      update.issued_at = new Date().toISOString();
      if (_plPath) update.pull_letter_url = _plPath;
    } else if (_plPath) {
      // Allow attaching the PDF on approval too (pre-issue), optional.
      update.pull_letter_url = _plPath;
    }

    const { data: pullLetter, error } = await supabaseAdmin
      .from('pullletters')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Send notification email (non-blocking). 'issued' uses the accepted
    // template until a dedicated 'issued' template is added.
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('email, name, email_language, language, country').eq('id', pullLetter.user_id).single();
    // 2026-08-03 — 'pending'/'on_hold' 는 내부 상태 전환일 뿐이라 회원에게
    // 메일을 보내지 않는다. (보류 사실을 매번 알리면 오히려 혼란)
    const _silent = status === 'pending' || status === 'on_hold';
    if (profile && !_silent) {
      const _lang = resolveEmailLang(profile);
      const isPositive = status === 'accepted' || status === 'approved' || status === 'issued';
      const tpl = status === 'issued'
        ? templates.pullletterIssued({ name: profile.name }, reviewNote, _lang)
        : isPositive
          ? templates.pullletterAccepted({ name: profile.name }, reviewNote, _lang)
          : templates.pullletterRejected({ name: profile.name }, reviewNote, _lang);
      sendEmail(profile.email, tpl).catch(() => {});
    }

    return res.status(200).json({ pullLetter });
  } catch (error) {
    console.error('Review pull-letter error:', error);
    return res.status(500).json({ message: 'Failed to review pull-letter' });
  }
};
