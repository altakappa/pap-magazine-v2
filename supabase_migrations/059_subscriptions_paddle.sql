-- 해외 결제 (Paddle Billing) 연동 — subscriptions 테이블 확장
--
-- ───────────────────────────────────────────────────────────────
-- 배경
-- ───────────────────────────────────────────────────────────────
-- 결제 이원화:
--   국내  → PortOne V2 빌링키 정기결제 (migration 007, 구현 완료)
--   해외  → Paddle Billing (Merchant of Record — EUR/USD 다통화 +
--           EU VAT 징수·신고 대행. 한국 법인 가입 가능)
--
-- Paddle 은 자체적으로 구독 상태를 관리하고 웹훅으로 통지하므로
-- 우리 쪽에는 참조 ID 두 개만 있으면 된다:
--   paddle_customer_id      — Paddle 고객 ID (ctm_…)
--   paddle_subscription_id  — Paddle 구독 ID (sub_…)
--
-- 한 유저는 국내(portone_*) 또는 해외(paddle_*) 중 하나의 결제
-- 수단만 가진다 (user_id UNIQUE upsert — 중복 구독은 webhook 과
-- checkout 양쪽에서 가드).

BEGIN;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paddle_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_sub
  ON public.subscriptions(paddle_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_customer
  ON public.subscriptions(paddle_customer_id);

COMMENT ON COLUMN public.subscriptions.paddle_customer_id     IS 'Paddle Billing customer id (ctm_…) — 해외 결제 레일';
COMMENT ON COLUMN public.subscriptions.paddle_subscription_id IS 'Paddle Billing subscription id (sub_…) — 해외 결제 레일';

COMMIT;
