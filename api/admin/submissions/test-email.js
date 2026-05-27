/**
 * POST /api/admin/submissions/test-email
 *
 * Admin-only utility for verifying that the submission-review email
 * (approved / rejected / revision) actually reaches the submitter.
 * Sends the chosen template to the admin's OWN profile email so they
 * can preview the live HTML in their inbox.
 *
 * Body:
 *   {
 *     status:   'approved' | 'rejected' | 'revision'   // required
 *     title:    string                                  // optional, default 'Test Editorial'
 *     lang:     'ko' | 'en' | 'it' | 'fr' | 'es' | 'ja' | 'zh' | 'ru' | 'de'   // optional, default = profile.email_language
 *     to:       string                                  // optional override, default = admin's own email
 *     approvalDay?:   string                            // optional, only used for status='approved'
 *     approvalMonth?: string
 *   }
 *
 * Response: { sent: bool, to: string, status: string, lang: string, messageId?: string }
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { sendEmail, templates } = require('../../_lib/email');

const VALID_STATUSES = ['approved', 'rejected', 'revision'];
const VALID_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
  }

  const status = body.status;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      message: 'status must be one of: ' + VALID_STATUSES.join(', '),
    });
  }

  // Look up the admin's profile so we can default the recipient + locale
  // to their own settings — mirrors what the real review endpoint does
  // when emailing the submitter.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('email, display_name, language, email_language')
    .eq('id', admin.id)
    .single();
  if (profileErr || !profile || !profile.email) {
    return res.status(400).json({
      message: 'Could not resolve admin email for test send',
    });
  }

  const to = (typeof body.to === 'string' && body.to.trim()) || profile.email;
  const lang = VALID_LANGS.includes(body.lang)
    ? body.lang
    : (profile.email_language || profile.language || 'en');
  const title = (typeof body.title === 'string' && body.title.trim())
    || ('[TEST] Sample Editorial — ' + status);
  const approvalDay = (status === 'approved' && body.approvalDay)
    ? String(body.approvalDay).trim() : '';
  const approvalMonth = (status === 'approved' && body.approvalMonth)
    ? String(body.approvalMonth).trim() : '';

  try {
    const tpl = templates.submissionReviewComplete(
      { name: profile.display_name || 'Test Recipient' },
      { title },
      lang,
      status,
      { approvalDay, approvalMonth }
    );
    // Prepend a small [TEST] banner to subject so the recipient knows
    // this isn't a real verdict.
    tpl.subject = '[TEST] ' + tpl.subject;

    const result = await sendEmail(to, tpl);
    if (!result || result.skipped) {
      return res.status(500).json({
        sent: false,
        to,
        status,
        lang,
        message: 'SMTP not configured on this environment (sendEmail returned skipped). Check Vercel env vars: SMTP_HOST, SMTP_USER, SMTP_PASS.',
      });
    }
    if (!result.sent) {
      return res.status(500).json({
        sent: false,
        to,
        status,
        lang,
        message: 'sendEmail failed',
        detail: result.error || 'unknown',
      });
    }
    return res.status(200).json({
      sent: true,
      to,
      status,
      lang,
      messageId: result.messageId,
      previewSubject: tpl.subject,
    });
  } catch (err) {
    console.error('[submission test-email] error', err);
    return res.status(500).json({
      sent: false,
      message: 'Server error',
      detail: err && err.message,
    });
  }
};
