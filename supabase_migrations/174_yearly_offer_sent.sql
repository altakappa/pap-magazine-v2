-- 174: 월간 2개월째 연간 제안 메일, 한 번만 (2026-10-01, api/_lib/yearlyOffer.js)
alter table public.subscriptions add column if not exists yearly_offer_sent_at timestamptz;
