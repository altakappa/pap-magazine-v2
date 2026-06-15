-- QA #206 — reset admin_edited_at on staged editorials that were never
-- actually edited by an admin.
--
-- Migration 035 introduced admin_edited_at and back-filled it from
-- updated_at on every row where updated_at - created_at > 60s, on the
-- theory that "the row was touched after the initial INSERT, so an
-- admin must have edited it." That heuristic was wrong for rows
-- created by /api/submissions/:id/review.js (the staged-editorial
-- path): the review endpoint stamps `instagram_caption` and
-- `description_en` AFTER the INSERT — sometimes via the embedding
-- best-effort step — which moves updated_at minutes ahead of
-- created_at even though no admin ever opened the row.
--
-- Result: the QA #197 rule "임시저장 = admin-authored OR
-- admin_edited_at IS NOT NULL" mis-classified those untouched staged
-- rows as edited, so the 임시저장 tab filled up with them. The QA
-- report's "최종 승인된 서브미션이 자동으로 에디토리얼 > 임시저장으로 이동됨"
-- is exactly this symptom.
--
-- Fix: any editorial that
--   1. has a source_submission_id (i.e. it was created by review.js)
--   2. AND has no audit-log entry of action='update' or 'publish'
--      (i.e. no admin PUT has touched it since QA #202 went live)
-- should have its admin_edited_at cleared back to NULL.
--
-- The audit log is the source of truth for "did an admin actually
-- edit this." Rows that predate the audit log (created before QA
-- #202) get a more permissive heuristic — we only clear when the
-- updated_at delta from created_at is small (< 10 minutes), which is
-- well within the staged-INSERT-then-stamp-caption window.

UPDATE public.editorials AS e
   SET admin_edited_at = NULL
 WHERE e.source_submission_id IS NOT NULL
   AND e.admin_edited_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.content_audit_log l
      WHERE l.content_type = 'editorial'
        AND l.content_id   = e.id
        AND l.action IN ('update','publish','unpublish')
   )
   AND (
     -- Either we have an audit log (created after QA #202) and the
     -- absence of update entries is decisive…
     EXISTS (SELECT 1 FROM public.content_audit_log)
     -- …or we don't, in which case fall back to the timestamp
     -- heuristic so we still clean up legacy rows.
     OR EXTRACT(EPOCH FROM (e.updated_at - e.created_at)) < 600
   );

-- Verification (run separately):
-- SELECT
--   COUNT(*) FILTER (WHERE source_submission_id IS NOT NULL AND admin_edited_at IS NULL) AS staged_untouched,
--   COUNT(*) FILTER (WHERE source_submission_id IS NOT NULL AND admin_edited_at IS NOT NULL) AS staged_touched
--   FROM public.editorials
--  WHERE status = 'draft';
