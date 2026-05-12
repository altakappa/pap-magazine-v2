-- 025_consent_tracking.sql
-- ------------------------------------------------------------------
-- Persist signup consent choices and provide an append-only history
-- of consent changes. Without this, the consent checkboxes on the
-- signup form are collected by the client but discarded server-side
-- — leaving the platform with no record of whether a given user
-- agreed to marketing emails / newsletter delivery, which the law
-- (정보통신망법 §50 / GDPR Art. 7) requires us to keep.
--
-- This migration is additive — it doesn't touch existing rows.
-- Existing members default to (NULL) for the timestamp fields and
-- (false) for the boolean opt-in flags, which is the safest default:
-- they won't receive marketing email until they explicitly opt in
-- from the mypage settings panel (added in the same commit).
-- ------------------------------------------------------------------

-- 1) profiles columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_consent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS age_consent_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_consent     BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS marketing_consent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_consent         BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS email_consent_at      TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.terms_consent_at IS
  'When the user agreed to the Terms of Service. NULL = no record (legacy member).';
COMMENT ON COLUMN public.profiles.privacy_consent_at IS
  'When the user agreed to the Privacy Policy. NULL = no record (legacy member).';
COMMENT ON COLUMN public.profiles.age_consent_at IS
  'When the user confirmed they are 14+. NULL = no record (legacy member).';
COMMENT ON COLUMN public.profiles.marketing_consent IS
  'OPT-IN to general marketing communications. Required filter for any promotional broadcast.';
COMMENT ON COLUMN public.profiles.email_consent IS
  'OPT-IN to email notifications (newsletter, new editorial alerts, celebrity news).';

-- Index the two boolean filters — they are the hot path for any
-- "send marketing email to X" query and we expect them to be selective
-- (typical opt-in rates are 30-60%, so a btree index is worthwhile).
CREATE INDEX IF NOT EXISTS profiles_marketing_consent_idx
  ON public.profiles (marketing_consent)
  WHERE marketing_consent = true;
CREATE INDEX IF NOT EXISTS profiles_email_consent_idx
  ON public.profiles (email_consent)
  WHERE email_consent = true;

-- 2) consent_history — append-only audit log
-- Purpose: regulators may ask "show me proof user X agreed to
-- marketing email on 2026-04-12". A single boolean column on profiles
-- only tells us the CURRENT state, not the history of toggles. Store
-- every grant/revoke event with timestamp + originating IP/UA.
CREATE TABLE IF NOT EXISTS public.consent_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type  TEXT NOT NULL CHECK (consent_type IN ('terms','privacy','age','marketing','email')),
  granted       BOOLEAN NOT NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address    INET,
  user_agent    TEXT,
  source        TEXT  -- 'signup' | 'mypage' | 'admin' | 'api'
);

CREATE INDEX IF NOT EXISTS consent_history_user_idx
  ON public.consent_history (user_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS consent_history_type_idx
  ON public.consent_history (consent_type, granted_at DESC);

ALTER TABLE public.consent_history ENABLE ROW LEVEL SECURITY;

-- Users can read their own history; admins can read everything.
CREATE POLICY "Users read own consent history"
  ON public.consent_history FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

-- Only the server (service-role key) writes to this table; no
-- INSERT/UPDATE/DELETE policies for regular users. This prevents
-- a compromised client from forging consent records.
