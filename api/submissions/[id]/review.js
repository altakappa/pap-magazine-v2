/**
 * PUT /api/submissions/:id/review — Admin review a submission
 *
 * Approval is a TWO-STEP flow: approving a submission stages it as an
 * editorial draft (status='draft', published_date=null). The editor then
 * tunes metadata in the admin and clicks 발행 to flip it to 'published'
 * via PUT /api/editorials/:id. Approval ≠ public exposure.
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

    // Stage as editorial draft. The editor will polish metadata and
    // explicitly hit 발행 to expose it publicly. We deliberately skip
    // embedAndStoreEditorial here — embeddings happen at publish time
    // so half-baked drafts don't leak into semantic search results.
    if (status === 'approved') {
      try {
        const desc = submission.description ? JSON.parse(submission.description) : {};
        const coverIdx = typeof coverImageIndex === 'number' ? coverImageIndex : (desc.coverImageIndex || 0);
        const coverUrl = submission.file_urls && submission.file_urls[coverIdx]
          ? submission.file_urls[coverIdx]
          : (submission.file_urls && submission.file_urls[0]) || null;

        if (coverUrl) {
          const tagsArr = Array.isArray(desc.genre) ? desc.genre : [];
          const description = (desc.artistStatement || '').trim() || null;
          // submissions has no `credits` column — pull from the
          // description JSON the submitter filled in. Editorial.credits
          // is jsonb, so wrap stray strings in {} to keep the shape.
          let credits = desc.credits || {};
          if (typeof credits === 'string') credits = credits.trim() ? { note: credits } : {};

          const { data: editorial, error: edErr } = await supabaseAdmin
            .from('editorials')
            .insert({
              title: submission.title,
              slug: null,
              cover_image: getOptimizedHero(coverUrl),
              thumbnail: getOptimizedThumbnail(coverUrl),
              gallery: submission.file_urls || [],
              credits,
              fashion: {},
              tags: tagsArr,
              issue: null,
              description,
              status: 'draft',
              published_date: null,
            })
            .select()
            .single();

          if (edErr) {
            console.error('Stage-as-editorial failed:', edErr);
          } else {
            const notePrefix = reviewNote || '';
            const newNote = notePrefix + (notePrefix ? '\n' : '') + '[Staged as editorial id: ' + editorial.id + ']';
            await supabaseAdmin
              .from('submissions')
              .update({ admin_notes: newNote })
              .eq('id', submission.id)
              .catch(err => console.error('Failed to update admin_notes:', err));
          }
        }
      } catch (stageErr) {
        console.error('Stage-as-editorial error:', stageErr);
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
