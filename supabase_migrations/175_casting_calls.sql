-- 175: 캐스팅 콜 (2026-10-02, 도메니코 "연간 혜택: 다음 호 캐스팅 콜 선공개")
-- 도메니코가 한국어로 한 줄 적으면, 연간 프리미엄 회원에게 먼저 메일(early_at)로 가고
-- 7일 뒤(public_at) 서브미션 페이지에서 모두에게 보인다. 번역은 community_translations 캐시(translate.js).
create table if not exists public.casting_calls (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  deadline    date,
  early_at    timestamptz not null default now(),
  public_at   timestamptz not null default (now() + interval '7 days'),
  sent_at     timestamptz,
  sent_count  integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists casting_calls_public_at_idx on public.casting_calls (public_at desc);
alter table public.casting_calls enable row level security;
-- 서버(service_role)만 만진다. anon/authenticated 정책 없음.
