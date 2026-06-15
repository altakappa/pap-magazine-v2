-- QA #208 Phase 2e — view_count column for editorials/articles/films/shorts.
--
-- Adds a denormalised view_count column to every content table so the
-- admin dashboard can sort/filter by popularity without aggregating the
-- editorial_views append log on every query.
--
-- For editorials we already have an append-only `editorial_views` table
-- (migration 012). To keep the new column in sync, this migration:
--   1) Backfills editorials.view_count from editorial_views.
--   2) Adds a trigger on editorial_views INSERT that increments
--      editorials.view_count by 1.
--
-- articles/films/shorts have no view log yet, so view_count stays at 0
-- until per-type view endpoints are added in a follow-up. That's fine —
-- the dashboard sort still works (everything ties at 0 → falls through
-- to the secondary sort key).
--
-- Idempotent: every CREATE/ALTER uses IF NOT EXISTS or OR REPLACE.

-- ── Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.films
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.shorts
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

-- Sort-friendly indexes (DESC because admin dashboard sorts highest-first).
CREATE INDEX IF NOT EXISTS idx_editorials_view_count
  ON public.editorials(view_count DESC);

CREATE INDEX IF NOT EXISTS idx_articles_view_count
  ON public.articles(view_count DESC);

CREATE INDEX IF NOT EXISTS idx_films_view_count
  ON public.films(view_count DESC);

CREATE INDEX IF NOT EXISTS idx_shorts_view_count
  ON public.shorts(view_count DESC);

COMMENT ON COLUMN public.editorials.view_count IS 'Denormalised view counter. Kept in sync by trigger on editorial_views INSERT. Backfilled from editorial_views row count.';
COMMENT ON COLUMN public.articles.view_count   IS 'Denormalised view counter. Incremented via POST /api/articles/:id/view (TBD).';
COMMENT ON COLUMN public.films.view_count      IS 'Denormalised view counter. Incremented via POST /api/films/:id/view (TBD).';
COMMENT ON COLUMN public.shorts.view_count     IS 'Denormalised view counter. Incremented via POST /api/shorts/:id/view (TBD).';

-- ── Backfill editorials from editorial_views log ─────────────────────────
UPDATE public.editorials e
   SET view_count = sub.cnt
  FROM (
    SELECT editorial_id, COUNT(*) AS cnt
      FROM public.editorial_views
     GROUP BY editorial_id
  ) sub
 WHERE e.id = sub.editorial_id
   AND e.view_count <> sub.cnt;

-- ── Trigger: keep editorials.view_count in sync ──────────────────────────
CREATE OR REPLACE FUNCTION public.bump_editorial_view_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.editorials
     SET view_count = view_count + 1
   WHERE id = NEW.editorial_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_editorial_view_count ON public.editorial_views;
CREATE TRIGGER trg_bump_editorial_view_count
  AFTER INSERT ON public.editorial_views
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_editorial_view_count();

-- Verification (run separately):
-- SELECT
--   (SELECT COUNT(*) FROM editorials WHERE view_count > 0) AS editorials_with_views,
--   (SELECT MAX(view_count) FROM editorials) AS max_view_count,
--   (SELECT SUM(view_count) FROM editorials) AS total_view_count,
--   (SELECT COUNT(*) FROM editorial_views) AS log_count;
-- The bottom two should match if backfill ran cleanly.
