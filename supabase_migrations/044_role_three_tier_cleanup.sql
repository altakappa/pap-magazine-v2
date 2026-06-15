-- QA #218 — three-role model (admin / staff / member) cleanup.
--
-- The 'contributor' role was leftover from an early creator/contributor
-- product line that never shipped. As of QA #218 the role set is:
--   admin  → 대표 관리자 (Main Admin)
--   staff  → 서브 관리자 (Sub Admin)
--   member → 일반 회원   (Member)
--
-- This migration:
--   1) Re-points any lingering 'contributor' profiles to 'member' so the
--      auth pipeline doesn't surface a role the UI no longer knows.
--   2) Adds a CHECK constraint so future inserts/updates can't reintroduce
--      a value outside the three-tier set.
--
-- Pre-check at QA #218 verified contributor count = 0 in production, so
-- step (1) is a no-op on the live DB but kept here for completeness.

-- 1) Fold any remaining 'contributor' rows into 'member'.
UPDATE public.profiles
   SET role = 'member'
 WHERE role = 'contributor';

-- 2) Lock the column to the canonical three values. DROP/CREATE so the
--    migration is idempotent and replaces an older constraint if present.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','staff','member'));

COMMENT ON CONSTRAINT profiles_role_check ON public.profiles IS
  'QA #218 three-tier role model: admin (대표 관리자) / staff (서브 관리자) / member (일반 회원). Legacy contributor folded into member.';

-- Verification (run separately):
-- SELECT role, COUNT(*) FROM public.profiles GROUP BY role ORDER BY role;
