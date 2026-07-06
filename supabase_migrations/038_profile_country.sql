-- 038_profile_country.sql
-- ------------------------------------------------------------------
-- Persist each member's country (ISO 3166-1 alpha-2) so the email
-- campaign renderer can derive the best newsletter language when the
-- member has never explicitly chosen one.
--
-- Locale resolution chain used by the send paths (email.js callers):
--   1) profiles.email_language  — explicit newsletter preference
--   2) profiles.language        — site UI language
--   3) countryToLang(country)   — geo-derived best guess  ← this column
--   4) 'en'                     — safe fallback
--
-- The column is captured opportunistically from Vercel's
-- `x-vercel-ip-country` header at signup and on authenticated /me
-- calls — no extra geo API cost, and it self-heals as members visit.
-- ------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country TEXT;

COMMENT ON COLUMN public.profiles.country IS
  'ISO 3166-1 alpha-2 country code (e.g. KR, JP, FR), captured from x-vercel-ip-country. Used as a locale fallback for newsletters.';

CREATE INDEX IF NOT EXISTS profiles_country_idx
  ON public.profiles (country);
