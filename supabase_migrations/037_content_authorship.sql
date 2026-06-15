-- QA #202 — author + last editor tracking on every content table.
--
-- Up to now the only "who" signal we had on content rows was
-- email_campaigns.created_by (migration 026). Editorials, articles,
-- films and shorts only carried timestamps (updated_at,
-- admin_edited_at) so the moment two admins started working it became
-- impossible to tell who shipped a post or who fixed a typo.
--
-- This migration adds:
--   - created_by  UUID → references the auth.users row of whoever
--                       first POSTed the content. NULL on legacy rows.
--   - updated_by  UUID → references the auth.users row of whoever
--                       last PUT the content. NULL on legacy rows.
--
-- Both are nullable on purpose — backfilling existing rows would lie
-- (we have no signal on who actually wrote them), and we'd rather
-- show "—" than fabricate authorship.
--
-- We index updated_by so the "내가 최근 수정한 글" panel on the admin
-- home can be cheap later. created_by gets an index for the symmetric
-- "내가 등록한 글" use case.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['editorials','articles','films','shorts']
  LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL', tbl);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_created_by ON public.%I(created_by) WHERE created_by IS NOT NULL', tbl, tbl);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_updated_by ON public.%I(updated_by) WHERE updated_by IS NOT NULL', tbl, tbl);

    EXECUTE format($f$COMMENT ON COLUMN public.%I.created_by IS 'auth.users.id of the admin who first POSTed this row. NULL for legacy rows authored before migration 037.'$f$, tbl);
    EXECUTE format($f$COMMENT ON COLUMN public.%I.updated_by IS 'auth.users.id of the admin who last PUT this row. NULL until the first admin-driven update after migration 037.'$f$, tbl);
  END LOOP;
END $$;

-- Verification (run separately):
-- SELECT
--   (SELECT COUNT(*) FROM editorials WHERE created_by IS NULL) AS edi_null_creator,
--   (SELECT COUNT(*) FROM articles   WHERE created_by IS NULL) AS art_null_creator,
--   (SELECT COUNT(*) FROM films      WHERE created_by IS NULL) AS film_null_creator,
--   (SELECT COUNT(*) FROM shorts     WHERE created_by IS NULL) AS shorts_null_creator;
