-- ============================================================================
-- PAP Magazine: split admin into Main Admin / Staff (QA #169)
-- ============================================================================
--
-- Background
--   The editorial team grew beyond a single admin, so we need a two-tier
--   role model:
--     - 'admin'  → 대표 관리자 (Main Admin) — final approve/reject on
--                  submissions, manages other staff
--     - 'staff'  → 서브 관리자 (Sub Admin) — can review submissions for
--                  revision, edit editorial drafts, publish content;
--                  CANNOT cast the final approve/reject vote
--     - 'contributor' → existing role; submitter-level access
--     - 'member'      → default; logged-in reader
--
--   We deliberately reuse the existing TEXT column (`role`) rather than
--   inventing an `is_main_admin` boolean. Reasons:
--     1) Avoids two sources of truth (role + flag) drifting apart.
--     2) Keeps RLS helpers (`public.is_admin()`) on a single check.
--     3) The promotion path is just `UPDATE … SET role='staff'` — no
--        secondary write needed.
--
--   Existing rows: every account currently marked 'admin' is automatically
--   the Main Admin going forward — no data migration required.
--
-- Idempotent: safe to re-run.

-- ─── 1) Add CHECK constraint codifying the allowed values ────────────────
-- Drop any prior constraint of the same name so a re-run with a tweaked
-- vocabulary succeeds. The constraint is intentionally LENIENT — it
-- allows rows with NULL/blank role (legacy backfill) to keep working.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_allowed_values'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_allowed_values;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_allowed_values
    CHECK (role IS NULL OR role IN ('member', 'contributor', 'staff', 'admin'));
END $$;

-- ─── 2) Update column comment so the schema explains itself ──────────────
COMMENT ON COLUMN public.profiles.role IS
  'Permission tier. member = default reader, contributor = submitter, '
  'staff = sub-admin (edits drafts, requests revisions, publishes), '
  'admin = main admin (final approve/reject, manages staff).';

-- ─── 3) Partial index for the rare "list every staff/admin" query ────────
-- Most calls touch a single profile by id; only the member-management
-- screen scans by elevated role. A partial index keeps that scan fast
-- without bloating the regular workload.
CREATE INDEX IF NOT EXISTS idx_profiles_elevated_role
  ON public.profiles (role)
  WHERE role IN ('staff', 'admin');

-- ─── 4) is_admin() RLS helper stays the same ─────────────────────────────
-- The existing function (000_prerequisites.sql) checks `role = 'admin'`.
-- We intentionally leave it untouched — RLS policies that gate writes on
-- is_admin() now correctly mean "main admin only", which matches our
-- intent for those tables (community comments, moodboards, etc.). Staff
-- access flows through the API layer's requireAdmin() helper, which
-- newly accepts both 'admin' AND 'staff'.
--
-- If we ever need an "is_staff_or_admin()" helper for RLS we can add it
-- in a follow-up migration; for now the API gates are enough.
