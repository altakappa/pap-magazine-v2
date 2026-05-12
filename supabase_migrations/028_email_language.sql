-- 028_email_language.sql
-- ------------------------------------------------------------------
-- Decouple "what language do you read the SITE in" from "what language
-- should your EMAIL newsletters arrive in". Real-world example: a
-- Korean designer reads pap-magazine.com in Korean but prefers her
-- weekly newsletter in English so she can forward it to international
-- collaborators. Today both queries hit profiles.language, so changing
-- one changes the other.
--
-- After this migration:
--   profiles.language        — site UI locale (existing, unchanged)
--   profiles.email_language  — newsletter locale (new)
--
-- The application layer (signup, mypage, cron) gets a dedicated
-- email_language field. When the column is null/unset, the email
-- send path falls back to profiles.language, which in turn falls
-- back to 'en' — so legacy rows never blackhole a send.
-- ------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_language TEXT;

COMMENT ON COLUMN public.profiles.email_language IS
  'Newsletter / marketing-email locale (ISO 639-1: ko/en/it/fr/es/ja/zh/ru/de). NULL = use profiles.language. Explicitly settable in mypage so users can split UI vs. inbox language.';

-- Backfill: copy current site language into email_language for every
-- existing row so the first newsletter after this migration ships in
-- the same locale they were reading the site in. New signups will
-- set both columns explicitly via the updated signup form.
UPDATE public.profiles
   SET email_language = language
 WHERE email_language IS NULL
   AND language IS NOT NULL;

-- Index used by the email cron's recipient query:
--   SELECT id, email, display_name, language, email_language
--    FROM profiles WHERE email_consent = true;
-- The existing email_consent partial index already narrows by opt-in;
-- this btree on email_language is for future segmented sends ("English
-- newsletter only").
CREATE INDEX IF NOT EXISTS profiles_email_language_idx
  ON public.profiles (email_language);
