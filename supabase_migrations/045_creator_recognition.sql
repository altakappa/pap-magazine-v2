-- QA #219 — Creator recognition marker.
--
-- Per QA #218 the role system stays as three tiers (admin / staff /
-- member) — it represents access permissions. Creator status is a
-- separate axis that recognises members whose submission was published
-- as an editorial. We track it on the profile with two new columns:
--
--   is_creator     BOOLEAN — flips true the first time the user has
--                            an editorial transition to 'published'
--   creator_since  TIMESTAMPTZ — stamp of when the recognition was
--                            first granted. Stays put even if later
--                            editorials are unpublished or the source
--                            submission is deleted (per policy: once
--                            a creator, always a creator unless an
--                            admin manually clears it).
--
-- A DB trigger on editorials handles the promotion so any code path
-- that flips status to 'published' (admin PUT, scheduled-publish
-- cron, manual SQL) consistently grants the badge. The trigger is
-- idempotent — flipping the same row to published twice doesn't
-- bump creator_since.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_creator BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creator_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_is_creator
  ON public.profiles(is_creator)
  WHERE is_creator;

COMMENT ON COLUMN public.profiles.is_creator IS
  'QA #219 — TRUE when the member has at least one editorial that has been published (via source_submission_id). Persists across editorial unpublishes.';
COMMENT ON COLUMN public.profiles.creator_since IS
  'QA #219 — Timestamp when the user was first promoted to creator. Used by admin UI to display "크리에이터 인증: yyyy-mm-dd".';

-- ── Trigger function ────────────────────────────────────────────────────
-- Fires AFTER UPDATE OF status on editorials. Only acts when the row is
-- transitioning INTO 'published' (so re-saving a row that's already
-- published is a no-op) and has a source_submission_id (admin-authored
-- editorials with no submission origin shouldn't grant anyone a badge).
CREATE OR REPLACE FUNCTION public.promote_creator_on_publish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NEW.source_submission_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only fire on the transition INTO 'published'.
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW; -- already published, no transition
  END IF;

  SELECT user_id INTO v_user_id
    FROM public.submissions
   WHERE id = NEW.source_submission_id;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles
     SET is_creator = TRUE,
         creator_since = COALESCE(creator_since, now())
   WHERE id = v_user_id
     AND is_creator = FALSE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_creator ON public.editorials;
CREATE TRIGGER trg_promote_creator
  AFTER INSERT OR UPDATE OF status ON public.editorials
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_creator_on_publish();

-- ── Backfill ────────────────────────────────────────────────────────────
-- Stamp every existing member whose submission was already published.
-- creator_since uses the editorial's published_date so the recognition
-- date matches reality. When multiple editorials qualify we keep the
-- earliest (MIN) so the displayed "since" reflects when the user first
-- earned the badge.
UPDATE public.profiles p
   SET is_creator = TRUE,
       creator_since = COALESCE(p.creator_since, ranked.first_pub)
  FROM (
    SELECT s.user_id, MIN(COALESCE(e.published_date::timestamptz, e.created_at)) AS first_pub
      FROM public.editorials e
      JOIN public.submissions s ON s.id = e.source_submission_id
     WHERE e.status = 'published'
       AND e.source_submission_id IS NOT NULL
       AND s.user_id IS NOT NULL
     GROUP BY s.user_id
  ) AS ranked
 WHERE p.id = ranked.user_id
   AND p.is_creator = FALSE;

-- Verification (run separately):
-- SELECT
--   COUNT(*) FILTER (WHERE is_creator) AS creators,
--   COUNT(*) FILTER (WHERE NOT is_creator) AS non_creators
-- FROM public.profiles;
