-- ============================================================================
-- PAP Magazine: track resubmission timestamp on submissions (QA #175)
-- ============================================================================
--
-- Background
--   After admin marks a submission as 'revision', the submitter
--   uploads a corrected version. The PUT /api/submissions/:id handler
--   flips status back to 'pending' so the editorial team sees it in the
--   queue again. But "fresh pending" and "resubmitted pending" looked
--   identical in the admin list, making it hard to triage the items
--   that already went through one revision round.
--
--   This migration adds a single nullable timestamp:
--     submissions.resubmitted_at  — set by the PUT handler each time a
--                                   submission is resubmitted after a
--                                   revision request. NULL = never been
--                                   through revision; non-NULL = at
--                                   least one round-trip happened.
--
--   The admin list uses this column to:
--     1) badge resubmitted-pending entries as "보완 완료" instead of
--        the generic "대기 중".
--     2) expose a "보완 완료" filter button alongside the existing
--        대기 중 / 보완 요청 / 승인 / 거절 filters (?status=resubmitted).
--
-- Idempotent: safe to re-run.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMPTZ;

-- Partial index for the new "보완 완료" filter (matches WHERE the API
-- query adds: status='pending' AND resubmitted_at IS NOT NULL). Cheap
-- because most submissions are NULL here.
CREATE INDEX IF NOT EXISTS idx_submissions_resubmitted_pending
  ON public.submissions (resubmitted_at)
  WHERE resubmitted_at IS NOT NULL;

COMMENT ON COLUMN public.submissions.resubmitted_at IS
  'Timestamp of the most recent resubmission (PUT /api/submissions/:id '
  'after status=revision). NULL = never went through revision. '
  'Admin list uses this + status=pending to render the "보완 완료" badge.';
