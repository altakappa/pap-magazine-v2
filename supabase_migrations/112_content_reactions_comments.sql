-- 112: 기사·에디토리얼 좋아요/댓글 (2026-08-07, 도메니코 지시 "다 적용해보자")
--
-- 왜 새 표인가 ────────────────────────────────────────────────────────
-- community_likes / community_comments 는 post_id 가 community_posts 를
-- 가리키는 FK 다. 기사에 못 붙인다. 그리고 그 표들은 역대 활동 0건이다 —
-- 커뮤니티가 /community 라는 별도 섬이라 아무도 가지 않기 때문이다.
--
-- 진단(2026-08-07): 회원 857명, 최근 30일 신규 278명. 그런데 기사 페이지에서
-- 할 수 있는 온사이트 액션이 스크랩 하나뿐이고, 참여 CTA는 전부 인스타
-- 아웃링크였다. 웹→인스타 16,016 vs 외부→웹 120.
-- 사람은 오는데 머무를 이유가 없었다.
--
-- actor_key 가 핵심 ──────────────────────────────────────────────────
-- 좋아요는 **로그인 없이** 누를 수 있어야 한다. 로그인을 요구하면 아무도
-- 안 누른다. 그래서 중복 방지 키를 회원/비회원 공통으로 만든다:
--     로그인   'u:<user_id>'
--     비로그인 'ip:<ip_hash>'
--
-- 부분 유니크 인덱스(where user_id is null)를 두 개 만드는 대신 이 방식을
-- 쓴 이유: 2026-08-07 마이그레이션 107 에서 부분 인덱스가 PostgREST 의
-- onConflict 에 안 먹혀 같은 영상이 두 번 게시된 사고가 있었다.
-- 술어 없는 유니크 하나가 안전하다.
-- 적용: 2026-08-07 프로덕션 반영 완료.

create table if not exists public.content_reactions (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('article','editorial','film','short')),
  target_id    uuid not null,
  kind         text not null default 'like' check (kind in ('like')),
  user_id      uuid references public.profiles(id) on delete set null,
  actor_key    text not null,
  created_at   timestamptz not null default now(),
  unique (target_type, target_id, kind, actor_key)
);

comment on table public.content_reactions is
  '기사·에디토리얼 좋아요. 비로그인도 누른다(actor_key=ip:<hash>). 로그인은 u:<id>.';
comment on column public.content_reactions.actor_key is
  '중복 방지 키. u:<user_id> 또는 ip:<ip_hash>. 부분 인덱스를 피하려고 한 칸으로 합쳤다.';

create index if not exists idx_content_reactions_target
  on public.content_reactions (target_type, target_id);

-- 댓글은 로그인을 요구한다. 좋아요와 달리 스팸 비용이 크고,
-- "댓글 쓰려면 로그인" 이 오히려 가입 유인이 된다.
create table if not exists public.content_comments (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('article','editorial','film','short')),
  target_id    uuid not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 1000),
  status       text not null default 'visible' check (status in ('visible','hidden','deleted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.content_comments is
  '기사·에디토리얼 댓글. 로그인 필수. status 로 숨김/삭제 — 행은 지우지 않는다.';

create index if not exists idx_content_comments_target
  on public.content_comments (target_type, target_id, created_at desc)
  where status = 'visible';
create index if not exists idx_content_comments_user
  on public.content_comments (user_id, created_at desc);
