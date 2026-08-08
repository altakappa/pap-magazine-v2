-- 113: ig_boosts — 골든아워 부스트 1회 보장 (2026-08-09)
-- 새 IG 게시물(특히 에디토리얼)이 감지되면 첫 90분 안에 스레드·X 가
-- 그 게시물로 트래픽을 쏜다. post_id PK 가 "게시물당 부스트 1회"를
-- DB 레벨에서 보장 (틱톡 중복 게시 사고의 교훈 — claim-first).
-- 부분 유니크 인덱스 금지 (마이그레이션 107 사고).
create table if not exists public.ig_boosts (
  post_id text primary key,
  permalink text not null,
  boosted_at timestamptz not null default now(),
  threads_ok boolean,
  x_ok boolean
);
comment on table public.ig_boosts is '골든아워 부스트 기록 — 게시물당 1회 (goldenBoost.js)';
