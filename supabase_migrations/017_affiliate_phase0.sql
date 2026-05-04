/**
 * PAP Magazine — Affiliate System Phase 0 (data foundation)
 * Step 17 in supabase_migrations/README.md execution order.
 *
 * Implements the schema spine for the affiliate system per AFFILIATE_SPEC.md
 * v2.0 (Lead Creator Payout, Wise-only, 3.3% withholding for KR residents,
 * 25th-of-month settlement, $50 minimum, 90-day expiry, 24-month click PII
 * retention).
 *
 * Six tables, all RLS-on:
 *
 *   1. brands              — canonical brand master (49 seed in migration 018)
 *   2. brand_aliases       — credit-string → brand_id mapping (PK = alias,
 *                            globally unique by design — see SPEC §1.2)
 *   3. affiliate_clicks    — append-only click log, PII minimised
 *                            (ip_hash + 100-char UA + path-only referrer)
 *   4. payout_batches      — monthly aggregation per creator + Wise tracking
 *   5. creator_earnings    — per-event ledger; references payout_batches once
 *                            a batch is composed
 *   6. kyc_records         — ID upload + 1-won bank verification + Wise email
 *
 * Tables 4–6 are Phase-2 territory in the spec but landing the schema now
 * lets later phases ship without another migration round.
 *
 * Idempotent: CREATE * IF NOT EXISTS, DO blocks check pg_policies before
 * CREATE POLICY. Safe to rerun.
 *
 * Notes:
 *   - editorial_brand_credits table is intentionally deferred to Phase 1
 *     when the auto-extraction job lands — leaving it out of Phase 0 keeps
 *     this migration tight.
 *   - lead_creator_id on affiliate_clicks is nullable: Phase 0 records
 *     clicks before the editorial→creator mapping pipeline exists; the
 *     Phase 1 backfill populates it.
 */

-- ── 1. brands ────────────────────────────────────────────────────────────
-- Canonical master. Status starts 'pending' for any seed/admin entry until
-- the affiliate URL is filled in; flip to 'active' to make /go/[id]
-- actually redirect (otherwise it falls back to home — see api/go/[id].js).
CREATE TABLE IF NOT EXISTS public.brands (
  brand_id                 TEXT PRIMARY KEY,
  display_name             TEXT NOT NULL,
  category                 TEXT NOT NULL CHECK (category IN ('fashion','beauty','accessories','footwear','bag','jewelry','other')),
  tier                     TEXT CHECK (tier IN ('luxury','contemporary','indie','mass')),
  affiliate_url_global     TEXT,
  affiliate_url_korea      TEXT,
  affiliate_network        TEXT CHECK (affiliate_network IN ('awin','ltk','skimlinks','direct')),
  commission_rate_global   NUMERIC(5,4),
  commission_rate_korea    NUMERIC(5,4),
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active','pending','archived')),
  instagram_handle         TEXT,
  note                     TEXT,
  rejected_reason          TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brands_status   ON public.brands (status);
CREATE INDEX IF NOT EXISTS idx_brands_category ON public.brands (category);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brands' AND policyname='public_read_brands') THEN
    CREATE POLICY public_read_brands ON public.brands FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brands' AND policyname='admin_write_brands') THEN
    CREATE POLICY admin_write_brands ON public.brands FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ── 2. brand_aliases ────────────────────────────────────────────────────
-- Credit-string lookups. PK = alias (already-normalised) so the same string
-- can never resolve to two brands; see SPEC §1.2. Confidence tracks how the
-- mapping was established — admin-curated, auto-rule, or pending review.
CREATE TABLE IF NOT EXISTS public.brand_aliases (
  alias       TEXT PRIMARY KEY,
  brand_id    TEXT NOT NULL REFERENCES public.brands(brand_id) ON DELETE CASCADE,
  confidence  TEXT NOT NULL DEFAULT 'pending' CHECK (confidence IN ('manual','auto','pending')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_aliases_brand_id ON public.brand_aliases (brand_id);

ALTER TABLE public.brand_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brand_aliases' AND policyname='public_read_brand_aliases') THEN
    CREATE POLICY public_read_brand_aliases ON public.brand_aliases FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brand_aliases' AND policyname='admin_write_brand_aliases') THEN
    CREATE POLICY admin_write_brand_aliases ON public.brand_aliases FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ── 3. affiliate_clicks ─────────────────────────────────────────────────
-- Append-only. PII-minimised per SPEC §2.2 + §8: SHA256(ip+salt) instead of
-- raw IP, first 100 chars of UA, referrer with query string stripped, plus
-- a self-expiring 24h session id. `counted = false` means the dedup rule
-- (same ip_hash × brand × 24h) fired — admin can re-evaluate later.
CREATE TABLE IF NOT EXISTS public.affiliate_clicks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            TEXT NOT NULL REFERENCES public.brands(brand_id) ON DELETE CASCADE,
  editorial_id        UUID REFERENCES public.editorials(id) ON DELETE SET NULL,
  lead_creator_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  region              TEXT NOT NULL CHECK (region IN ('KR','GLOBAL')),
  referrer_path       TEXT,
  ip_hash             TEXT NOT NULL,
  user_agent_short    TEXT,
  device_type         TEXT CHECK (device_type IN ('mobile','desktop','tablet')),
  session_id          TEXT,
  session_expires_at  TIMESTAMPTZ,
  counted             BOOLEAN NOT NULL DEFAULT TRUE,
  clicked_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot paths: dedup lookup (ip+brand+24h), creator earnings rollup, brand reporting.
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_dedup
  ON public.affiliate_clicks (ip_hash, brand_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_brand_at
  ON public.affiliate_clicks (brand_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_lead_at
  ON public.affiliate_clicks (lead_creator_id, clicked_at DESC) WHERE lead_creator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_editorial
  ON public.affiliate_clicks (editorial_id) WHERE editorial_id IS NOT NULL;

ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Anonymous INSERT — the redirector runs without auth (visitors aren't
  -- logged in for click tracking). Server controls what gets written.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='affiliate_clicks' AND policyname='anon_insert_click') THEN
    CREATE POLICY anon_insert_click ON public.affiliate_clicks FOR INSERT WITH CHECK (true);
  END IF;
  -- Admin-only SELECT — even hashed PII stays admin-only.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='affiliate_clicks' AND policyname='admin_read_click') THEN
    CREATE POLICY admin_read_click ON public.affiliate_clicks FOR SELECT USING (public.is_admin());
  END IF;
  -- No public UPDATE/DELETE — append-only by policy. Admin can still bypass via service-role.
END $$;

-- ── 4. payout_batches ───────────────────────────────────────────────────
-- One row per (creator, year, month) once settlement composes the batch.
-- All amounts denormalised so historical batches stay reproducible even if
-- exchange rates / withholding policy change later.
CREATE TABLE IF NOT EXISTS public.payout_batches (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_year              INT NOT NULL,
  period_month             INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  gross_creator_share_usd  NUMERIC(12,2) NOT NULL,
  withholding_usd          NUMERIC(12,2) NOT NULL DEFAULT 0,    -- 3.3% for KR residents
  net_usd                  NUMERIC(12,2) NOT NULL,
  net_local_currency       TEXT NOT NULL DEFAULT 'USD',
  net_local_amount         NUMERIC(14,2),
  exchange_rate            NUMERIC(14,6),                       -- BOK rate at settlement
  residency_country        TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','sent','paid','failed','expired')),
  wise_transfer_id         TEXT,
  failure_count            INT NOT NULL DEFAULT 0,
  last_attempt_at          TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,                         -- earned_at + 90d for unclaimed expiry
  paid_at                  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta                     JSONB,
  UNIQUE (creator_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_payout_batches_status      ON public.payout_batches (status);
CREATE INDEX IF NOT EXISTS idx_payout_batches_creator     ON public.payout_batches (creator_id, period_year DESC, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_payout_batches_expires_at  ON public.payout_batches (expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payout_batches' AND policyname='own_read_payouts') THEN
    CREATE POLICY own_read_payouts ON public.payout_batches FOR SELECT USING (auth.uid() = creator_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payout_batches' AND policyname='admin_all_payouts') THEN
    CREATE POLICY admin_all_payouts ON public.payout_batches FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ── 5. creator_earnings ─────────────────────────────────────────────────
-- Event ledger. One row per attributable event (a confirmed conversion, a
-- manual adjustment, a reversal, etc). status walks pending → approved →
-- paid (or reversed). payout_batch_id is set once a monthly batch consumes
-- this row; before that it's NULL.
CREATE TABLE IF NOT EXISTS public.creator_earnings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  click_id            UUID REFERENCES public.affiliate_clicks(id) ON DELETE SET NULL,
  editorial_id        UUID REFERENCES public.editorials(id) ON DELETE SET NULL,
  brand_id            TEXT REFERENCES public.brands(brand_id) ON DELETE SET NULL,
  amount_usd          NUMERIC(12,2) NOT NULL,                 -- gross commission from network
  creator_share_usd   NUMERIC(12,2) NOT NULL,                 -- portion routed to creator (tier-driven)
  pap_share_usd       NUMERIC(12,2) NOT NULL,                 -- portion retained by PAP
  tier_at_event       TEXT,                                   -- snapshot for audit
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','reversed')),
  payout_batch_id     UUID REFERENCES public.payout_batches(id) ON DELETE SET NULL,
  earned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta                JSONB
);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator_at ON public.creator_earnings (creator_id, earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_status     ON public.creator_earnings (status);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_batch      ON public.creator_earnings (payout_batch_id) WHERE payout_batch_id IS NOT NULL;

ALTER TABLE public.creator_earnings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='creator_earnings' AND policyname='own_read_earnings') THEN
    CREATE POLICY own_read_earnings ON public.creator_earnings FOR SELECT USING (auth.uid() = creator_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='creator_earnings' AND policyname='admin_all_earnings') THEN
    CREATE POLICY admin_all_earnings ON public.creator_earnings FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ── 6. kyc_records ──────────────────────────────────────────────────────
-- One row per creator. doc_storage_path points at a private Storage bucket
-- (creator_kyc) — contents encrypted at rest by Supabase + we never serve
-- the raw URL to the client. Bank account number is hash-stored only;
-- humans (admin) reference it via the verification flow, not by reading
-- the column directly.
CREATE TABLE IF NOT EXISTS public.kyc_records (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id                  UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_storage_path            TEXT,
  doc_uploaded_at             TIMESTAMPTZ,
  bank_verified               BOOLEAN NOT NULL DEFAULT FALSE,
  bank_verified_at            TIMESTAMPTZ,
  bank_account_owner          TEXT,
  bank_name                   TEXT,
  bank_account_number_hash    TEXT,
  residency_country           TEXT,
  payout_email                TEXT,                               -- Wise-registered email for non-KR
  last_changed_at             TIMESTAMPTZ NOT NULL DEFAULT now(), -- 7-day cooldown enforced in app
  status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_status     ON public.kyc_records (status);
CREATE INDEX IF NOT EXISTS idx_kyc_residency  ON public.kyc_records (residency_country);

ALTER TABLE public.kyc_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kyc_records' AND policyname='own_read_kyc') THEN
    CREATE POLICY own_read_kyc ON public.kyc_records FOR SELECT USING (auth.uid() = creator_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kyc_records' AND policyname='own_insert_kyc') THEN
    CREATE POLICY own_insert_kyc ON public.kyc_records FOR INSERT WITH CHECK (auth.uid() = creator_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kyc_records' AND policyname='own_update_kyc') THEN
    CREATE POLICY own_update_kyc ON public.kyc_records FOR UPDATE USING (auth.uid() = creator_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kyc_records' AND policyname='admin_all_kyc') THEN
    CREATE POLICY admin_all_kyc ON public.kyc_records FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;
