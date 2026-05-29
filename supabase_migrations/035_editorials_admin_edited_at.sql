-- QA #197 — split "real" draft editorials from auto-staged ones.
--
-- Before: a submission approval auto-created an editorial with
--   status='draft' + source_submission_id={submission.id}. The
--   editor's "Drafts" tab then mixed those with admin-authored drafts,
--   making it impossible to tell apart "in-progress work" from
--   "freshly approved, awaiting curation".
--
-- After: editorials.admin_edited_at is bumped whenever the admin
--   explicitly PUTs a change to the editorial. The Drafts tab query
--   becomes (source_submission_id IS NULL) OR (admin_edited_at IS NOT NULL)
--   — i.e. either it was admin-authored OR the admin has touched it
--   since staging. Untouched staged rows are routed to the submission
--   review surface instead.

ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS admin_edited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_editorials_admin_edited_at
  ON public.editorials(admin_edited_at)
  WHERE admin_edited_at IS NOT NULL;

COMMENT ON COLUMN public.editorials.admin_edited_at IS
  'Timestamp of the last explicit admin edit via PUT /api/editorials/:id. NULL means the row was auto-staged from a submission and has not been touched by an admin yet. Used by the Drafts tab filter to separate user-authored drafts from auto-staged ones.';

-- Backfill: any existing editorial that was last updated by an admin
-- (we have no precise audit trail, so we use updated_at as a proxy
-- where it differs from created_at by more than 60s — that's the
-- threshold for "an admin definitely touched this"). Source rows
-- created from a submission AND never edited will have updated_at
-- within a few seconds of created_at and stay NULL.
UPDATE public.editorials
   SET admin_edited_at = updated_at
 WHERE admin_edited_at IS NULL
   AND updated_at IS NOT NULL
   AND created_at IS NOT NULL
   AND EXTRACT(EPOCH FROM (updated_at - created_at)) > 60;

-- Verification (run separately):
-- SELECT
--   COUNT(*) FILTER (WHERE admin_edited_at IS NOT NULL) AS edited_count,
--   COUNT(*) FILTER (WHERE admin_edited_at IS NULL)     AS untouched_count,
--   COUNT(*) FILTER (WHERE source_submission_id IS NOT NULL AND admin_edited_at IS NULL) AS still_staged_count
-- FROM public.editorials
-- WHERE status='draft';
