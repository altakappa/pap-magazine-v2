-- 172: 해지 사유 한 문항 (2026-09-29, 도메니코 "세 개 진행해줘"). 마이페이지 해지 확인창에서 고른 이유.
-- 강제 아님: 안 고르고 해지하면 'skipped' 로 남겨 응답률도 잰다. 9/24 분석의 "화보 1편용 1회 구매" 가설을 추측이 아니라 답으로 확인하기 위한 표.
create table if not exists public.subscription_cancel_reasons (
  id          bigserial primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  provider    text,
  plan        text,
  reason      text not null check (reason in ('one_editorial','price','not_using','missing_feature','other','skipped')),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists subscription_cancel_reasons_created_idx on public.subscription_cancel_reasons (created_at desc);
alter table public.subscription_cancel_reasons enable row level security;
comment on table public.subscription_cancel_reasons is '마이페이지 해지 시 고른 이유 1개(선택). skipped = 안 고름.';
