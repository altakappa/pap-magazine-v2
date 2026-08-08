-- 115: 웹 푸시 (B-7) — 구독 저장 + 발송 기록 (2026-08-09)
-- 부분 유니크 인덱스 금지 (107 교훈). endpoint 가 브라우저별 유일 키.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  user_id uuid,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  disabled_at timestamptz
);
-- 발송 기록: 하루 상한(알림 신뢰 보호)과 성적표의 근거
create table if not exists public.push_broadcasts (
  id bigint generated always as identity primary key,
  post_id text,
  title text,
  sent integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.push_subscriptions is '웹 푸시 구독 (B-7) — 새 화보 알림';
comment on table public.push_broadcasts is '푸시 발송 기록 — 하루 2건 상한의 근거';
