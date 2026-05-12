-- 027_profile_language.sql
-- ------------------------------------------------------------------
-- Persist each member's preferred site language so server-side jobs
-- (especially the email-campaign cron) can pick the correct
-- translation. Without this, the marketing email rendering layer has
-- no way to know that user X reads PAP in Japanese — it would have to
-- default everyone to English or Korean, defeating the point of
-- maintaining 9 locales on the site.
--
-- The default is 'en' so unknown / legacy users get a safe fallback
-- that's understandable to most subscribers. The application code
-- ALSO falls back to 'en' inside the email template if the column
-- happens to contain a value we don't have a translation for —
-- belt + suspenders so a typo in this column can't blackhole a send.
-- ------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en' NOT NULL;

COMMENT ON COLUMN public.profiles.language IS
  'ISO 639-1 code matching the site''s i18n keys: ko/en/it/fr/es/ja/zh/ru/de. Default ''en''.';

-- Index for the campaign-cron path:
--   SELECT id, email, display_name, language
--    FROM profiles WHERE email_consent = true;
-- The existing email_consent partial index already narrows by opt-in.
-- This btree on language is mostly future-proofing for "send only to
-- Korean speakers" segmented campaigns (no current caller does this,
-- but the data is now there).
CREATE INDEX IF NOT EXISTS profiles_language_idx
  ON public.profiles (language);
