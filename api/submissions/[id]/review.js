/**
 * PUT /api/submissions/:id/review — Admin review a submission
 * Supports auto-publishing approved submissions as articles
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { sendEmail, templates } = require('../../_lib/email');
const { getOptimizedThumbnail, getOptimizedHero } = require('../../_lib/imageOptimize');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

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
    const { status, reviewNote, coverImageIndex } = req.body;

    if (!status || !['approved', 'rejected', 'revision'].includes(status)) {
      return res.status(400).json({ message: 'Status must be "approved", "rejected", or "revision"' });
    }

    // Validate coverImageIndex if provided
    if (typeof coverImageIndex !== 'undefined' && (typeof coverImageIndex !== 'number' || coverImageIndex < 0)) {
      return res.status(400).json({ message: 'coverImageIndex must be a non-negative number' });
    }

    const { data: submission, error } = await supabaseAdmin
      .from('submissions')
      .update({
        status,
        admin_notes: reviewNote || '',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Auto-publish: Create article from approved submission
    if (status === 'approved') {
      try {
        const desc = submission.description ? JSON.parse(submission.description) : {};
        const coverIdx = typeof coverImageIndex === 'number' ? coverImageIndex : (desc.coverImageIndex || 0);
        const coverUrl = submission.file_urls && submission.file_urls[coverIdx]
          ? submission.file_urls[coverIdx]
          : (submission.file_urls && submission.file_urls[0]) || null;

        if (coverUrl) {
          const { data: article, error: articleError } = await supabaseAdmin
            .from('articles')
            .insert({
              title: submission.title,
              subtitle: desc.artistStatement || '',
              category: (desc.genre && Array.isArray(desc.genre) && desc.genre[0]) || 'Editorial',
              tags: (Array.isArray(desc.genre) ? desc.genre : []) || [],
              thumbnail_url: getOptimizedThumbnail(coverUrl),
              hero_image_url: getOptimizedHero(coverUrl),
              content: desc.artistStatement || submission.title,
              gallery: submission.file_urls || [],
              credits: submission.credits || desc.credits || '',
              status: 'published',
              published_date: new Date().toISOString()
            })
            .select()
            .single();

          if (articleError) {
            console.error('Auto-publish failed:', articleError);
            // Don't fail the review - submission is still approved
          } else {
            // Update submission with published article ID reference
            const notePrefix = reviewNote || '';
            const newNote = notePrefix + (notePrefix ? '\n' : '') + '[Auto-published as article ID: ' + article.id + ']';
            await supabaseAdmin
              .from('submissions')
              .update({ admin_notes: newNote })
              .eq('id', submission.id)
              .catch(err => console.error('Failed to update admin_notes with article ID:', err));
          }
        }
      } catch (autoPublishError) {
        console.error('Auto-publish error:', autoPublishError);
        // Don't fail the review - submission is still approved
      }
    }

    // Send notification email (non-blocking). Pick the template that matches
    // the actual decision so the submitter gets the correct message — earlier
    // versions fell back to the rejected template for any non-approved status,
    // which incorrectly framed revision requests as outright rejections.
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('email, name').eq('id', submission.user_id).single();
    if (profile) {
      let tpl;
      if (status === 'approved') {
        tpl = templates.submissionApproved({ name: profile.name }, { title: submission.title }, reviewNote);
      } else if (status === 'revision') {
        tpl = templates.submissionRevision({ name: profile.name }, { title: submission.title }, reviewNote);
      } else {
        tpl = templates.submissionRejected({ name: profile.name }, { title: submission.title }, reviewNote);
      }
      sendEmail(profile.email, tpl).catch(() => {});
    }

    return res.status(200).json({ submission });
  } catch (error) {
    console.error('Review submission error:', error);
    return res.status(500).json({ message: 'Failed to review submission' });
  }
};
