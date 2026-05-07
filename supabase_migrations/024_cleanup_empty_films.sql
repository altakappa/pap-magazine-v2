/**
 * PAP Magazine — Archive films with empty editorial-level metadata
 * Step 24 in supabase_migrations/README.md execution order.
 *
 * Background: prior to migration 023 + the admin form rebuild, the only
 * fields the admin could fill on a new film were title / youtube_id /
 * thumbnail_url / status. Every other field (categories, credits, slug,
 * published_date, tags) stayed at its DEFAULT value. So films created
 * via the old admin path now sit in the table with no metadata, while
 * legacy migrated films have rich metadata. The frontend renders both
 * uniformly, so the empty films look broken (no credits, no date,
 * no slug).
 *
 * This migration ARCHIVES (not deletes) every film whose categories
 * array is empty AND credits JSONB is the empty array — the signature
 * of "created via the old 4-field admin form, never enriched". Rows
 * stay in the table at status='archived' so they're hidden from public
 * GET /api/films but still recoverable by an admin.
 *
 * Run AFTER 023 (no schema dependency, but logical sequencing). Re-run
 * is safe — already-archived rows match the WHERE clause but the UPDATE
 * is a no-op on status.
 */

-- Sanity check: print the row count we're about to touch so the admin
-- running this in the SQL editor sees the impact before commit.
DO $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM public.films
  WHERE coalesce(array_length(categories, 1), 0) = 0
    AND credits = '[]'::jsonb
    AND status <> 'archived';
  RAISE NOTICE 'Films to archive (empty categories AND empty credits AND not already archived): %', n;
END $$;

UPDATE public.films
SET status = 'archived',
    updated_at = now()
WHERE coalesce(array_length(categories, 1), 0) = 0
  AND credits = '[]'::jsonb
  AND status <> 'archived';
