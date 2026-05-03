/**
 * PAP Magazine — Editorial view tracking + trending lookup
 * Step 12 in supabase_migrations/README.md execution order.
 *
 * Powers the "인기 에디토리얼" row on index.html. Replaces hardcoded picks
 * with a real popularity signal driven by user opens of the editorial detail.
 *
 * Design notes (deliberately minimal — see PR for trade-offs):
 *   - Append-only views table (no UPDATE / no UPSERT) → cheapest write path,
 *     and lets us slice by any time window without losing history.
 *   - Stores ONLY editorial_id + viewed_at. No IP, no user-agent, no user_id.
 *     GDPR-friendly out of the gate; if we ever want logged-in analytics we
 *     can add a nullable user_id without touching downstream code.
 *   - RLS: anonymous INSERT allowed (page tracking from logged-out visitors
 *     must work), SELECT restricted to admin (raw view rows are admin-only;
 *     the public trending endpoint reads via service-role bypass).
 *   - trending_editorials() RPC encapsulates the GROUP BY + window so the API
 *     route is a one-line call. Marked STABLE so PG can cache within a query.
 *
 * Idempotent: CREATE IF NOT EXISTS + DROP/CREATE for the function so the
 * migration can be re-run safely.
 */

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.editorial_views (
  id           BIGSERIAL PRIMARY KEY,
  editorial_id UUID NOT NULL REFERENCES public.editorials(id) ON DELETE CASCADE,
  viewed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trending lookup hits (editorial_id, viewed_at). Latest-views purge hits viewed_at.
CREATE INDEX IF NOT EXISTS idx_editorial_views_editorial_at
  ON public.editorial_views (editorial_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_editorial_views_at
  ON public.editorial_views (viewed_at);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.editorial_views ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'editorial_views' AND policyname = 'anon_insert_view'
  ) THEN
    CREATE POLICY anon_insert_view
      ON public.editorial_views
      FOR INSERT
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'editorial_views' AND policyname = 'admin_read_view'
  ) THEN
    CREATE POLICY admin_read_view
      ON public.editorial_views
      FOR SELECT
      USING (public.is_admin());
  END IF;
END $$;

-- ── Trending RPC ─────────────────────────────────────────────────────────
-- Returns top N published editorials by view count in the last `period_hours`.
-- Use 168 for 7d, 24 for 1d, 720 for 30d.
DROP FUNCTION IF EXISTS public.trending_editorials(INT, INT);
CREATE OR REPLACE FUNCTION public.trending_editorials(
  period_hours INT,
  max_items    INT
)
RETURNS TABLE (
  id             UUID,
  title          VARCHAR,
  slug           VARCHAR,
  cover_image    TEXT,
  published_date DATE,
  url            TEXT,
  tags           TEXT[],
  thumbnail      TEXT,
  view_count     BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.id,
    e.title,
    e.slug,
    e.cover_image,
    e.published_date,
    e.url,
    e.tags,
    e.thumbnail,
    COUNT(ev.id) AS view_count
  FROM public.editorials e
  INNER JOIN public.editorial_views ev ON ev.editorial_id = e.id
  WHERE ev.viewed_at > now() - (period_hours::TEXT || ' hours')::INTERVAL
    AND e.status = 'published'
  GROUP BY e.id
  ORDER BY view_count DESC, e.published_date DESC NULLS LAST
  LIMIT max_items;
$$;

-- The function reads editorial_views which is RLS-restricted. Grant execute
-- to anon/authenticated so the public API (running with service-role) and
-- direct PostgREST callers can both use it. Service role bypasses RLS, so
-- the actual SELECT inside the function works regardless.
GRANT EXECUTE ON FUNCTION public.trending_editorials(INT, INT) TO anon, authenticated, service_role;
