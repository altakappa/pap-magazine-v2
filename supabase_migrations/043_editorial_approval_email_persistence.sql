-- QA #214 — persist the approval-email curator settings on the editorial.
--
-- Before this migration only `approval_email_sent_at` was kept, which
-- timestamped a successful send but lost the day/month the curator typed
-- into the modal. Re-opening the editorial showed an empty form, leaving
-- the editor unsure whether the mail had gone out and tempting a second
-- send.
--
-- New columns:
--   approval_email_day            TEXT — exact string the editor typed
--                                        for the "around the X" slot
--   approval_email_month          TEXT — same for the month slot
--   approval_email_status         TEXT — one of:
--                                          'pending'   — never sent
--                                          'sent'      — mailer reported success
--                                          'failed'    — mailer threw / SMTP off
--   approval_email_failed_reason  TEXT — error string when status='failed'
--
-- The editorials PUT handler stores day/month verbatim alongside the
-- existing send flag, then flips status based on the mailer result.
-- Re-opening the editorial hydrates all four columns into the modal so
-- the editor sees the exact configuration that was last saved.

ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS approval_email_day TEXT,
  ADD COLUMN IF NOT EXISTS approval_email_month TEXT,
  ADD COLUMN IF NOT EXISTS approval_email_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approval_email_failed_reason TEXT;

-- Backfill: any editorial that already has a sent_at timestamp gets
-- status='sent' so the new UI shows the right badge for legacy rows.
UPDATE public.editorials
   SET approval_email_status = 'sent'
 WHERE approval_email_sent_at IS NOT NULL
   AND (approval_email_status IS NULL OR approval_email_status = 'pending');

CREATE INDEX IF NOT EXISTS idx_editorials_approval_email_status
  ON public.editorials(approval_email_status)
  WHERE source_submission_id IS NOT NULL;

COMMENT ON COLUMN public.editorials.approval_email_day IS 'Day-of-month text the curator entered for the approval mail body. Persisted so re-opening the editorial hydrates the value.';
COMMENT ON COLUMN public.editorials.approval_email_month IS 'Month text the curator entered for the approval mail body. Persisted so re-opening the editorial hydrates the value.';
COMMENT ON COLUMN public.editorials.approval_email_status IS 'pending | sent | failed. Drives the admin UI badge so the editor knows at a glance whether the mail reached the submitter.';
COMMENT ON COLUMN public.editorials.approval_email_failed_reason IS 'Error string captured when send fails. Cleared on the next successful send.';
