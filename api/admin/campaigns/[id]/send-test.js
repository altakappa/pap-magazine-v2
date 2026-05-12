/**
 * POST /api/admin/campaigns/:id/send-test
 *
 * Body: { email?: string }   // defaults to the calling admin's address
 *
 * Sends ONE rendered copy of the campaign to the supplied address so
 * the admin can preview it in their inbox before scheduling. Does NOT
 * touch email_log, recipient_count, or campaign status — this is a
 * QA path, not a real broadcast.
 *
 * Unsubscribe link in the test email points to a real token so the
 * "unsubscribe page" can be QA'd end-to-end, but the token's user_id
 * is the calling admin (so testing doesn't accidentally opt out a
 * different person).
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAdmin } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');
const { sendEmail, templates } = require('../../../_lib/email');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ message: 'id is required' });

  try {
    const { data: campaign, error } = await supabaseAdmin
      .from('email_campaigns').select('*').eq('id', id).single();
    if (error) throw error;
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const targetEmail = (req.body && req.body.email && String(req.body.email).trim()) || admin.email;
    if (!targetEmail) {
      return res.status(400).json({ message: 'No target email — supply { email } or ensure admin has an email' });
    }

    const templateFn = campaign.type === 'editorial-weekly'
      ? templates.weeklyEditorial
      : campaign.type === 'news-weekly'
        ? templates.weeklyNews
        : null;
    if (!templateFn) {
      return res.status(400).json({ message: `No template for campaign type "${campaign.type}"` });
    }

    // Mint a token attributed to the admin so any unsubscribe click
    // during testing toggles the admin's own consent, not someone else's.
    const { data: tok, error: tokErr } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .insert({ user_id: admin.id, campaign_id: campaign.id })
      .select('token')
      .single();
    if (tokErr) throw tokErr;

    // Look up the admin's preferred newsletter locale so the test
    // preview matches what a real recipient with the same preference
    // would see. Precedence mirrors the cron path: email_language
    // (explicit pref) > language (site UI) > 'en'.
    let adminLang = 'en';
    try {
      const { data: pr } = await supabaseAdmin
        .from('profiles').select('language, email_language').eq('id', admin.id).single();
      if (pr) adminLang = pr.email_language || pr.language || 'en';
    } catch (_) { /* falls through to 'en' */ }

    const fakeUser = {
      id: admin.id,
      email: targetEmail,
      display_name: (admin.name || admin.email || 'PAP Admin') + ' (TEST)',
      language: adminLang,
    };
    const built = templateFn(campaign, fakeUser, tok.token);
    // Prepend [TEST] to the subject so it's unmistakable in the inbox.
    built.subject = '[TEST] ' + built.subject;
    const result = await sendEmail(targetEmail, built);
    if (!result || result.sent !== true) {
      return res.status(500).json({ message: 'Send failed', error: result && result.error });
    }
    return res.status(200).json({ ok: true, to: targetEmail });
  } catch (err) {
    console.error('[admin/campaigns/:id/send-test]', err.message || err);
    return res.status(500).json({ message: err.message || 'Failed' });
  }
};
