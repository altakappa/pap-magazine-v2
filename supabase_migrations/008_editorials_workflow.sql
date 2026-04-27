-- ============================================================================
-- PAP Magazine: Editorial workflow tools — schedule, SEO, multilingual
-- ============================================================================
--
-- Phase 4 of the workflow improvements. Three additions to the editorials
-- table, all idempotent:
--
--   1. scheduled_publish_at — admin can stage an editorial as 'published'
--      with a future timestamp; the public GET filters it out until the
--      timestamp passes.
--   2. SEO meta — seo_title, seo_description, og_image so each editorial
--      can override the homepage defaults for proper Google / OpenGraph
--      cards when shared on social.
--   3. Multilingual title/description — title_en, description_en (TEXT).
--      The Korean originals stay in the existing title / description
--      columns; English versions are populated by the admin (manually or
--      via the existing /api/translate Claude endpoint, wired to the
--      editorial editor in a follow-up).
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS guards every change.

ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seo_title            TEXT,
  ADD COLUMN IF NOT EXISTS seo_description      TEXT,
  ADD COLUMN IF NOT EXISTS og_image             TEXT,
  ADD COLUMN IF NOT EXISTS title_en             TEXT,
  ADD COLUMN IF NOT EXISTS description_en       TEXT;

-- Index to make the public-list filter "published AND visible now"
-- cheap even as the table grows.
CREATE INDEX IF NOT EXISTS idx_editorials_status_schedule
  ON public.editorials (status, scheduled_publish_at);

-- Convenience view for the public site: only editorials that are
-- (a) status='published' AND (b) either no schedule or schedule has passed.
-- The frontend can read from this view instead of the raw table for safer
-- defaults, and the admin keeps using public.editorials directly.
CREATE OR REPLACE VIEW public.editorials_public AS
SELECT *
FROM public.editorials
WHERE status = 'published'
  AND (scheduled_publish_at IS NULL OR scheduled_publish_at <= now());

GRANT SELECT ON public.editorials_public TO anon, authenticated;
