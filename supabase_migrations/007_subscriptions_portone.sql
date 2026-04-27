-- ============================================================================
-- PAP Magazine: PortOne billing fields on subscriptions
-- ============================================================================
--
-- The original subscriptions table (000_prerequisites.sql:77) was scaffolded
-- with Stripe in mind. Korea uses PortOne (formerly iamport) for recurring
-- billing, so we extend the same table — keeping a single source of truth
-- for billing data — instead of creating a parallel `subscribers` table.
--
-- This migration is idempotent: it only adds columns/indexes when they
-- don't already exist, so it's safe to re-run.

-- ─── PortOne columns ─────────────────────────────────────────────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS portone_billing_key TEXT,
  ADD COLUMN IF NOT EXISTS portone_payment_id  TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle       VARCHAR(20);  -- 'monthly' | 'yearly'

CREATE INDEX IF NOT EXISTS idx_subscriptions_portone_key
  ON public.subscriptions (portone_billing_key);

-- ─── Allow upsert on (user_id) so the API can write a single row per user ─
-- The original table doesn't have a UNIQUE constraint on user_id, so an
-- upsert with onConflict='user_id' fails. Adding a UNIQUE constraint here
-- makes "one active subscription per user" enforceable at the DB level.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_unique'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- ─── Helper: trigger to keep updated_at fresh ────────────────────────────
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
