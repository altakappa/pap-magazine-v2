-- QA #194 — Fix the two Security Advisor errors flagged on 2026-05-27.
--
-- Both `editorial_rating_stats` and `editorials_public` were created
-- with the implicit SECURITY DEFINER property (Postgres default for
-- views when the owner is a privileged role). That makes them run with
-- the OWNER'S permissions, not the calling user's — which silently
-- bypasses any RLS policies on the underlying tables.
--
-- The fix is one of:
--   A. Switch to SECURITY INVOKER (Postgres 15+) so the view honours
--      the caller's RLS. This is what we want for analytics views.
--   B. Recreate the view without the DEFINER clause.
--
-- Pattern A is preferred — it preserves the view's existing dependents
-- (admin dashboards, embedded queries) without a schema rebuild.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'editorial_rating_stats'
  ) THEN
    EXECUTE 'ALTER VIEW public.editorial_rating_stats SET (security_invoker = true)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'editorials_public'
  ) THEN
    EXECUTE 'ALTER VIEW public.editorials_public SET (security_invoker = true)';
  END IF;
END $$;

-- Verification (run separately after migration):
--   SELECT viewname, viewowner FROM pg_views WHERE schemaname='public'
--     AND viewname IN ('editorial_rating_stats','editorials_public');
--   SELECT relname, reloptions FROM pg_class WHERE relname IN
--     ('editorial_rating_stats','editorials_public');
-- The reloptions output should now include security_invoker=true.
