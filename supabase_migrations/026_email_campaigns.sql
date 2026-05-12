-- 026_email_campaigns.sql
-- ------------------------------------------------------------------
-- Recurring newsletter infrastructure. PAP needs to send a weekly
-- editorial roundup + weekly news brief to consented members. The
-- admin curates the content in admin.html, schedules a send time,
-- and a Vercel cron picks up due campaigns and delivers them via
-- Resend SMTP. This migration adds the persistence layer:
--
--   email_campaigns          one row per broadcast (editorial OR news)
--   email_log                one row per recipient per campaign
--   email_unsubscribe_tokens single-use tokens for one-click opt-out
--                            links embedded in every marketing email
--
-- Why a token table instead of signing a JWT into the link:
--   1) Single-use semantics — we can null `used_at` to invalidate
--   2) Audit trail of which tokens were minted for which campaigns
--   3) Plain UUID is shorter/cleaner in URLs than a 200-byte JWT
-- ------------------------------------------------------------------

-- 1) Campaigns
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,        -- 'editorial-weekly-2026-05-12'
  type            TEXT NOT NULL CHECK (type IN ('editorial-weekly','news-weekly','one-off')),
  subject         TEXT NOT NULL,
  preheader       TEXT,                  -- preview text in inbox client (Gmail/Outlook)
  hero_headline   TEXT,                  -- big title inside the email body
  hero_body       TEXT,                  -- editor's note paragraph
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
                                         -- type-specific data:
                                         -- editorial-weekly: { editorialIds: [uuid,...] }
                                         -- news-weekly:      { newsItems: [{title, summary, url, image}, ...] }
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at    TIMESTAMPTZ,           -- when cron should pick this up
  sent_at         TIMESTAMPTZ,           -- when send actually completed
  recipient_count INT DEFAULT 0,
  sent_count      INT DEFAULT 0,
  failed_count    INT DEFAULT 0,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- The cron handler does:
--   SELECT * FROM email_campaigns
--    WHERE status='scheduled' AND scheduled_at <= now()
--    ORDER BY scheduled_at ASC LIMIT 5
-- so a partial index on that hot path keeps the cron snappy even
-- when historical campaigns pile up over years.
CREATE INDEX IF NOT EXISTS email_campaigns_due_idx
  ON public.email_campaigns (scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS email_campaigns_status_idx
  ON public.email_campaigns (status, created_at DESC);

-- 2) Per-recipient send log
CREATE TABLE IF NOT EXISTS public.email_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','sent','failed','bounced','opened','clicked')),
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  clicked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_log_campaign_idx
  ON public.email_log (campaign_id, status);
CREATE INDEX IF NOT EXISTS email_log_user_idx
  ON public.email_log (user_id, created_at DESC);

-- 3) Single-use unsubscribe tokens
-- One token per (user, campaign) — minted at send time, redeemed
-- when the user clicks the unsubscribe link in their email.
-- Storing campaign_id lets us report "how many opted out from THIS
-- specific campaign" (a key deliverability metric).
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_unsubscribe_tokens_user_idx
  ON public.email_unsubscribe_tokens (user_id);

-- RLS
ALTER TABLE public.email_campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribe_tokens  ENABLE ROW LEVEL SECURITY;

-- Admins only — these tables hold marketing operations data and
-- per-recipient send status, which is never user-facing. Service-role
-- key writes through them; no policy is needed for non-admin reads.
CREATE POLICY "Admins read campaigns"
  ON public.email_campaigns FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins read email log"
  ON public.email_log FOR SELECT
  USING (public.is_admin());

-- Users can SELECT their own tokens (used by the unsubscribe page
-- to confirm the token belongs to them when not logged in — though
-- in practice we use the service-role client there since the link
-- works without login).
CREATE POLICY "Users read own unsubscribe tokens"
  ON public.email_unsubscribe_tokens FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());
