-- ──────────────────────────────────────────────────────────────────────
-- PAP Magazine — Supabase Migration Template
-- Copy this file as `NNN_short_description.sql` (next number after the
-- highest existing migration, currently 033). Replace placeholder blocks
-- and delete sections you don't need.
--
-- QA #194 (2026-10-30 deadline) — Supabase Data API stops auto-exposing
-- `public` tables. From that date forward, the GRANT block below is
-- MANDATORY for any new table you want PostgREST / GraphQL / supabase-js
-- to see. Existing tables in this database are NOT affected by the
-- change. ALTER TABLE ... ADD COLUMN migrations don't need new grants
-- (they inherit the table's existing grants).
-- ──────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────
-- SECTION 1 — Schema changes
-- ───────────────────────────────────────────────────────────────

-- Example: brand-new table.
CREATE TABLE IF NOT EXISTS public.example_table (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Example: adding a column to an existing table (no new grants needed).
-- ALTER TABLE public.editorials ADD COLUMN IF NOT EXISTS new_field TEXT;

-- Example: dropping a column.
-- ALTER TABLE public.editorials DROP COLUMN IF EXISTS old_field;


-- ───────────────────────────────────────────────────────────────
-- SECTION 2 — Indexes (recommended for any column used in WHERE / JOIN)
-- ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_example_table_user_id    ON public.example_table(user_id);
CREATE INDEX IF NOT EXISTS idx_example_table_created_at ON public.example_table(created_at DESC);


-- ───────────────────────────────────────────────────────────────
-- SECTION 3 — Data API exposure (MANDATORY for new tables after 2026-10-30)
-- ───────────────────────────────────────────────────────────────

-- Without these grants, PostgREST / GraphQL / supabase-js silently
-- skip the table — it appears not to exist via the API.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.example_table
  TO anon, authenticated;

-- If the table uses a sequence (BIGSERIAL etc.), also grant on the
-- sequence so client inserts work. UUID-keyed tables don't need this.
-- GRANT USAGE, SELECT ON SEQUENCE public.example_table_id_seq TO anon, authenticated;


-- ───────────────────────────────────────────────────────────────
-- SECTION 4 — Row Level Security (always recommended)
-- ───────────────────────────────────────────────────────────────

ALTER TABLE public.example_table ENABLE ROW LEVEL SECURITY;

-- Pattern A — public read, owner-only write (common for user-generated content)
CREATE POLICY "Anyone can read example_table"
  ON public.example_table FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own rows"
  ON public.example_table FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rows"
  ON public.example_table FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own rows"
  ON public.example_table FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Pattern B — admin-only (e.g. dashboards). Use profile.role check.
-- CREATE POLICY "Admins can do anything on example_table"
--   ON public.example_table
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.profiles
--       WHERE id = auth.uid() AND role IN ('admin', 'staff')
--     )
--   );

-- Pattern C — fully private (only api/* via service_role can access).
-- Do NOT add any policy + keep RLS enabled. service_role bypasses RLS.


-- ───────────────────────────────────────────────────────────────
-- SECTION 5 — Optional triggers (updated_at auto-bump)
-- ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_example_table_updated_at ON public.example_table;
CREATE TRIGGER trg_example_table_updated_at
  BEFORE UPDATE ON public.example_table
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


-- ───────────────────────────────────────────────────────────────
-- SECTION 6 — Verification (run after migration completes)
-- ───────────────────────────────────────────────────────────────

-- 1) Table exists with expected columns
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='example_table'
--  ORDER BY ordinal_position;

-- 2) Grants are correct (should list anon + authenticated for SELECT/INSERT/UPDATE/DELETE)
-- SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_schema='public' AND table_name='example_table'
--  ORDER BY grantee, privilege_type;

-- 3) RLS is enabled
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname='example_table';

-- 4) Policies are listed
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename='example_table';
