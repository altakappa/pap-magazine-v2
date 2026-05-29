/**
 * PAP Magazine - Editorial Detail API
 * GET    /api/editorials/:id   → 에디토리얼 상세 조회 (공개)
 * PUT    /api/editorials/:id   → 에디토리얼 수정 (관리자)
 * DELETE /api/editorials/:id   → 에디토리얼 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { embedAndStoreEditorial } = require('../_lib/embeddings');
const { sendEmail, templates } = require('../_lib/email');

// QA #172 / QA #185 — Approval-email trigger.
// Fires from POST and PUT when the admin ticks "✉️ 저장 시 승인 메일 발송"
// in the editorial save modal. As of QA #185 the initial approval mail
// is auto-sent at REVIEW time (without publication day/month), so this
// path now acts as an explicit RE-SEND with the curated publication
// schedule + payment block. To keep it idempotent across accidental
// double-saves we still check approval_email_sent_at — but only block
// when the timestamp lies within the last 60 seconds. Older stamps
// from the review-time auto-send are intentionally overridden so the
// editor's deliberate tick on this checkbox always reaches the inbox.
// Conditions to actually send:
//   1) editorial has a source_submission_id (was staged from a submission)
//   2) approval_email_sent_at is older than 60s OR null
//   3) we can look up the submitter's email
async function _maybeSendApprovalEmail(editorialRow, opts) {
  if (!editorialRow || !editorialRow.id) return;
  if (!opts || !opts.sendApprovalEmail) return;
  if (!editorialRow.source_submission_id) return;
  if (editorialRow.approval_email_sent_at) {
    const lastMs = new Date(editorialRow.approval_email_sent_at).getTime();
    if (!isNaN(lastMs) && (Date.now() - lastMs) < 60_000) {
      // Stamped within the last minute — almost certainly a debounce of
      // a save that already triggered this same path. Skip to avoid
      // duplicate sends, but allow legitimate resends after the cool-off.
      return;
    }
  }

  try {
    const { data: submission } = await supabaseAdmin
      .from('submissions')
      .select('user_id, title')
      .eq('id', editorialRow.source_submission_id)
      .single();
    if (!submission || !submission.user_id) return;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, display_name, language, email_language')
      .eq('id', submission.user_id)
      .single();
    if (!profile || !profile.email) return;

    const lang = profile.email_language || profile.language || 'en';
    const tpl = templates.submissionReviewComplete(
      { name: profile.display_name || '' },
      // Use the editorial's CURRENT title — admin may have renamed it
      // since the submission was filed.
      { title: editorialRow.title || submission.title },
      lang,
      'approved',
      { approvalDay: opts.approvalDay || '', approvalMonth: opts.approvalMonth || '' }
    );
    const result = await sendEmail(profile.email, tpl);
    // Only stamp the timestamp when the mailer reports success. A
    // "skipped" (SMTP not configured) or "sent:false" run leaves the
    // column NULL so a follow-up retry can succeed once SMTP is back.
    if (result && result.sent) {
      await supabaseAdmin
        .from('editorials')
        .update({ approval_email_sent_at: new Date().toISOString() })
        .eq('id', editorialRow.id);
    }
  } catch (err) {
    console.error('[editorial approval-email] send failed:', err && err.message);
  }
}

// Re-embed only when fields that drive the embedding text actually change.
// Saves an OpenAI call (and a DB write) on routine admin edits like fixing
// a typo in `gallery` or toggling status.
const EMBED_TRIGGERS = ['title', 'description', 'tags'];
function shouldReembed(updates) {
  for (const k of EMBED_TRIGGERS) {
    if (Object.prototype.hasOwnProperty.call(updates, k)) return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      // QA #163 — reverse-fan in the films that point at this editorial
      // via films.related_editorial_id so the detail page can render a
      // "Related Films" section without a second round-trip. Limit to
      // published films and a sane projection (id/slug/title/thumbnail/
      // youtube_id/published_date) so the response stays small even when
      // a single editorial gets multiple linked films over time.
      const { data, error } = await supabaseAdmin
        .from('editorials')
        .select('*, related_films:films!related_editorial_id(id,slug,title,thumbnail_url,youtube_id,published_date,status)')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Editorial not found' });
      }

      // Filter out unpublished films before sending — service-role bypasses
      // RLS so we have to enforce visibility here. (Doing it post-fetch
      // keeps the join shape simple — Supabase doesn't yet support an
      // .eq() on the joined table directly when there's no explicit
      // relationship hint.)
      if (Array.isArray(data.related_films)) {
        data.related_films = data.related_films
          .filter(f => f && f.status === 'published')
          .sort((a, b) => String(b.published_date || '').localeCompare(String(a.published_date || '')));
      }

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Editorial GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch editorial' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      // Phase 4: scheduled_publish_at, seo_*, og_image, title_en, description_en
      // are part of the allowlist so the admin form can save them.
      const allowed = [
        'title', 'slug', 'cover_image', 'published_date', 'url', 'tags',
        'issue', 'thumbnail', 'gallery', 'credits', 'fashion', 'status', 'description',
        'scheduled_publish_at', 'seo_title', 'seo_description', 'og_image',
        'title_en', 'description_en',
        // QA #170 — editor-tunable Instagram caption (auto-seeded at
        // submission approval; admin can hand-edit before publishing).
        'instagram_caption',
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      // Detect a draft→published transition so we can stamp published_date
      // and force an embed below. We need the prior status for that.
      let priorStatus = null;
      if (updates.status !== undefined) {
        const { data: prior } = await supabaseAdmin
          .from('editorials')
          .select('status, published_date')
          .eq('id', id)
          .single();
        priorStatus = prior ? prior.status : null;
        const becomingPublished = updates.status === 'published' && priorStatus !== 'published';
        if (becomingPublished && updates.published_date === undefined && (!prior || !prior.published_date)) {
          updates.published_date = new Date().toISOString();
        }
      }

      // QA #197 — stamp admin_edited_at on every admin PUT. This is what
      // lets the Drafts tab tell apart "admin actually curated this" from
      // "auto-staged at submission approval, never touched". The admin's
      // draft list query reads (source_submission_id IS NULL OR
      // admin_edited_at IS NOT NULL); writing here flips the second arm
      // true so the row starts appearing in 임시저장 from now on.
      updates.admin_edited_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from('editorials')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Re-embed when the admin changed embedding-relevant text OR when the
      // editorial is going public for the first time (drafts staged from
      // submissions never got an initial embed — we skip that to avoid
      // indexing half-baked work).
      const becomingPublished = updates.status === 'published' && priorStatus !== 'published';
      if (shouldReembed(updates) || becomingPublished) {
        try { await embedAndStoreEditorial(data); }
        catch (e) { console.warn('[editorial PUT] re-embed failed', e && e.message); }
      }

      // QA #172 — fire the approval email when the admin ticked the
      // checkbox. Idempotent: re-saving with the box still ticked won't
      // resend because approval_email_sent_at is now stamped.
      await _maybeSendApprovalEmail(data, {
        sendApprovalEmail: req.body.send_approval_email === true,
        approvalDay: req.body.approval_day || '',
        approvalMonth: req.body.approval_month || '',
      });

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Editorial PUT error:', err);
      return res.status(500).json({ error: 'Failed to update editorial' });
    }
  }

  // DELETE: 삭제
  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { error } = await supabaseAdmin
        .from('editorials')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ message: 'Editorial deleted' });
    } catch (err) {
      console.error('Editorial DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete editorial' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
