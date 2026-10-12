-- 179: 플랜 변경 예약 (2026-10-12, 도메니코 "제대로 된 길로 가자")
-- 활성 구독자가 다른 플랜(스탠다드↔프리미엄, 월간↔연간)을 고르면 새 PayPal 구독을
-- 현재 기간 종료일(start_time)에 시작시킨다. 그 사이 행은 지금 플랜 그대로 두고
-- 예약 정보만 여기에 적는다. 첫 결제가 오면 paypal-webhook 이 행을 새 플랜으로 바꾸고 비운다.
alter table public.subscriptions add column if not exists pending_plan text;
alter table public.subscriptions add column if not exists pending_billing_cycle text;
alter table public.subscriptions add column if not exists pending_paypal_subscription_id text;
alter table public.subscriptions add column if not exists pending_start_at timestamptz;
