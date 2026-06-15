-- QA #211 — Auto-purge policy for rejected submissions.
--
-- A rejected submission keeps the user's uploaded look images on storage
-- forever, which (a) inflates the storage bill and (b) makes the admin
-- list noisier than it needs to be.
--
-- New column `rejected_at` stamps the exact time a submission was rejected.
-- A daily cron (api/cron/purge-rejected-submissions.js) scans for rows where
-- rejected_at < now() - 30 days, deletes the Supabase Storage objects, then
-- hard-deletes the row. Within the 30-day window the admin can recover the
-- submission by flipping status back to 'pending'.
--
-- Backfill: any submission that's currently `status='rejected'` AND has no
-- rejected_at stamp gets its `updated_at` copied in. updated_at is a safe
-- proxy because the rejection PUT is what last mutated the row.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- Cron scan needs an index that hits the (status, rejected_at) pair.
CREATE INDEX IF NOT EXISTS idx_submissions_rejected_at
  ON public.submissions(rejected_at)
  WHERE status = 'rejected' AND rejected_at IS NOT NULL;

COMMENT ON COLUMN public.submissions.rejected_at IS
  'Timestamp the submission was rejected. Used by the auto-purge cron to find rows older than 30 days. NULL for non-rejected submissions.';

-- Backfill existing rejected rows.
UPDATE public.submissions
   SET rejected_at = updated_at
 WHERE status = 'rejected'
   AND rejected_at IS NULL
   AND updated_at IS NOT NULL;

-- Verification (run separately):
-- SELECT
--   COUNT(*) FILTER (WHERE status='rejected') AS total_rejected,
--   COUNT(*) FILTER (WHERE status='rejected' AND rejected_at IS NULL) AS missing_stamp,
--   COUNT(*) FILTER (WHERE status='rejected' AND rejected_at < now() - interval '30 days') AS purge_candidates
-- FROM public.submissions;
