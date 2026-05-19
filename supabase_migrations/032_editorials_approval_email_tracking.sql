-- ============================================================================
-- PAP Magazine: editorial approval email tracking (QA #172)
-- ============================================================================
--
-- Background
--   The approval workflow now decouples "submission approved" from
--   "submitter notified". Editors approve a submission to stage it as an
--   editorial draft, but the actual approval email goes out later — when
--   the editor finalises the editorial (cover, credits, IG caption,
--   publication date) and presses 저장 with the "✉️ 저장 시 승인 메일 발송"
--   checkbox ticked.
--
--   To support that flow we need two new fields on editorials:
--
--     1) source_submission_id  — points back at the submission row this
--        editorial was staged from. Used by the editorial save handler to
--        look up the submitter's email when the checkbox is ticked.
--        Nullable — admin-created editorials (no source submission) leave
--        it NULL, which also disables the approval-email branch entirely.
--
--     2) approval_email_sent_at — TIMESTAMPTZ stamped when the approval
--        email actually goes out. Acts as an idempotency guard so the
--        editor can press 저장 repeatedly without re-sending the email.
--        NULL = "haven't sent yet"; the save handler only sends when
--        the checkbox is ticked AND this column is NULL.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS source_submission_id    UUID REFERENCES public.submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_email_sent_at  TIMESTAMPTZ;

-- Quick lookup for the (rare) audit query "which editorials came from
-- submission X?" — partial because most editorials are admin-created and
-- have a NULL source.
CREATE INDEX IF NOT EXISTS idx_editorials_source_submission
  ON public.editorials (source_submission_id)
  WHERE source_submission_id IS NOT NULL;

COMMENT ON COLUMN public.editorials.source_submission_id IS
  'Submission this editorial was staged from (review.js → editorials INSERT). '
  'NULL for admin-created editorials. Used by the editorial save handler '
  'to look up the submitter when the approval-email checkbox is ticked.';

COMMENT ON COLUMN public.editorials.approval_email_sent_at IS
  'Timestamp the approval-complete email actually went out. Acts as an '
  'idempotency guard so admin pressing 저장 multiple times never '
  're-sends the email. NULL = not yet sent.';
