-- ──────────────────────────────────────────────────────────────────────
-- PAP Magazine — Submission base-fee payment tracking (2단계-b, 2026-07-19)
--
-- ⚠️ 실행: 도메니코가 Supabase(igcazquhkwxtqsaqpznx)에서 직접 실행.
--    (이 파일은 작성만 — Claude는 DB에 적용하지 않는다.)
--
-- Background
--   Submissions can carry a one-time BASE FEE when they fall outside the free
--   editorial policy (Domenico-confirmed 2026-07-19):
--     • few-looks  → €345  (34500 euro-cents)
--     • branded    → €720  (72000 euro-cents)
--   The fee is charged via a Paddle ONE-TIME transaction (not a subscription).
--   api/paddle-webhook.js handles `transaction.completed` events whose
--   custom_data.kind === 'submission_fee' and flips ONLY the payment columns
--   below. Publication (status/approved) stays 100% manual — draft-only.
--
--   This migration adds three nullable, additive columns. No behavior change
--   for existing rows: payment_status defaults to 'none', the rest are NULL.
--
-- Idempotent: safe to re-run (IF NOT EXISTS on every column + index).
-- ALTER ... ADD COLUMN inherits the table's existing grants — no new GRANT
-- block needed (QA #194 only applies to brand-new tables).
-- ──────────────────────────────────────────────────────────────────────

-- payment_status: none | awaiting_payment | paid
--   none             — no fee applies (free submission) OR not yet initiated.
--   awaiting_payment — fee due, checkout opened, not yet confirmed.
--   paid             — Paddle transaction.completed received & verified.
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(32) DEFAULT 'none';

-- paid_amount: the charged base fee in euro-cents (€345 → 34500, €720 → 72000).
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS paid_amount INTEGER;

-- paddle_transaction_id: Paddle transaction id (txn_…). Doubles as the
-- idempotency key — the webhook skips a submission already stamped with the
-- same transaction id, so a re-delivered event never double-processes.
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS paddle_transaction_id VARCHAR(255);

-- Idempotency lookup + guard against two submissions claiming one transaction.
-- Partial UNIQUE index (only non-NULL ids participate) so the many NULL rows
-- don't collide and the webhook's "same tx already applied" check is O(index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_paddle_tx
  ON public.submissions (paddle_transaction_id)
  WHERE paddle_transaction_id IS NOT NULL;

-- Admin filtering on payment state (awaiting_payment / paid queues).
CREATE INDEX IF NOT EXISTS idx_submissions_payment_status
  ON public.submissions (payment_status)
  WHERE payment_status IS NOT NULL AND payment_status <> 'none';

COMMENT ON COLUMN public.submissions.payment_status IS
  'Base-fee payment state: none | awaiting_payment | paid. Set to paid ONLY by '
  'the Paddle webhook (transaction.completed, kind=submission_fee). Publication '
  'stays manual — this column never affects status/approved.';
COMMENT ON COLUMN public.submissions.paid_amount IS
  'Charged base fee in euro-cents (few-looks 34500 / branded 72000).';
COMMENT ON COLUMN public.submissions.paddle_transaction_id IS
  'Paddle transaction id (txn_…). Idempotency key for the submission-fee webhook branch.';
