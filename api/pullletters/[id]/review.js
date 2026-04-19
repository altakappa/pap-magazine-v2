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
    const { status, reviewNote } = req.body;

    if (!status || !['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be "accepted" or "rejected"' });
    }

    const { data: pullLetter, error } = await supabaseAdmin
      .from('pullletters')
      .update({
        status,
        admin_notes: reviewNote || '',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Send notification email (non-blocking)
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('email, name').eq('id', pullLetter.user_id).single();
    if (profile) {
      const tpl = status === 'accepted'
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
