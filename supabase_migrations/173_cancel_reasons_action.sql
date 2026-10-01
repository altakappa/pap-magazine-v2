-- 173: 해지 사유 표에 action 열 (2026-10-01). 'cancel' | 'pause'. 쉬어가기를 고른 사람과 해지한 사람을 가른다.
alter table public.subscription_cancel_reasons add column if not exists action text not null default 'cancel' check (action in ('cancel','pause'));
