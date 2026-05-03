/**
 * PUT /api/pullletters/:id/review — Admin review a pull-letter
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { sendEmail, templates } = require('../../_lib/email');

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
    if (!status || !['accepted', 'approved', 'rejected', 'issued'].includes(status)) {
      return res.status(400).json({ message: 'Status must be one of: accepted, approved, rejected, issued' });
    }

    const update = {
      status,
      admin_notes: reviewNote || '',
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    };
    if (status === 'issued') {
      update.issued_at = new Date().toISOString();
      if (pullLetterPath) update.pull_letter_url = pullLetterPath;
    } else if (typeof pullLetterPath === 'string') {
      // Allow attaching the PDF on approval too (pre-issue), optional.
      update.pull_letter_url = pullLetterPath;
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
      .from('profiles').select('email, name').eq('id', pullLetter.user_id).single();
    if (profile) {
      const isPositive = status === 'accepted' || status === 'approved' || status === 'issued';
      const tpl = isPositive
        ? templates.pullletterAccepted({ name: profile.name }, reviewNote)
        : templates.pullletterRejected({ name: profile.name }, reviewNote);
      sendEmail(profile.email, tpl).catch(() => {});
    }

    return res.status(200).json({ pullLetter });
  } catch (error) {
    console.error('Review pull-letter error:', error);
    return res.status(500).json({ message: 'Failed to review pull-letter' });
  }
};
