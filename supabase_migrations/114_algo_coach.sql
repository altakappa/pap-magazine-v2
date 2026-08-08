-- 114: algo_coach — 게시물 3시간령 조기 판정 기록 (2026-08-09)
-- 게시물당 코칭 1회 보장 (PK claim-first). 부분 유니크 인덱스 금지(107 교훈).
create table if not exists public.algo_coach (
  post_id text primary key,
  verdict text check (verdict in ('hot','mid','cold')),
  likes_3h integer,
  p50 integer,
  p75 integer,
  coached_at timestamptz not null default now()
);
comment on table public.algo_coach is '3시간령 조기 판정 — hot 이면 골든타임 액션 알림 (algo-coach 크론)';
