-- QA #204 — editorials.description_it.
--
-- Up to now the Italian translation only existed inside the combined
-- instagram_caption blob (the "(IT) ..." section), which made it
-- impossible to:
--   - re-show the translation on a future edit (the admin form only
--     bound to description / description_en);
--   - render an IT-localised version of the editorial on the SPA
--     when /editorial/<slug>?lang=it eventually lands;
--   - re-run the caption regenerator without losing the existing IT
--     copy (the regenerator builds the caption from the per-language
--     description slots, so a missing slot meant the IT line vanished).
--
-- Adding a dedicated TEXT column brings IT in line with KR (description)
-- and EN (description_en). The Claude generator already returns kr/en/it
-- in a single payload, so it's just a matter of persisting the third
-- slot. Nullable on purpose — existing rows that only ever stored an
-- IT line inside the caption blob stay valid and the auto-generate
-- endpoint will backfill them on demand.

ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS description_it TEXT;

COMMENT ON COLUMN public.editorials.description_it IS
  'Italian translation of the editorial description, produced by the Claude AI generator alongside description (KR) and description_en. NULL on legacy rows; the admin editorial editor can re-trigger the generator to backfill.';

-- Verification (run separately):
-- SELECT
--   COUNT(*) FILTER (WHERE description_it IS NOT NULL) AS has_it,
--   COUNT(*) FILTER (WHERE description_it IS NULL)     AS missing_it,
--   COUNT(*) AS total
-- FROM public.editorials;
