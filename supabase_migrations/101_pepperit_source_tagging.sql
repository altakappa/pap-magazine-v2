-- 101_pepperit_source_tagging.sql
-- 2026-08-05 · 도메니코 지시 2건
--   ① celeb-watch 큐에 '페퍼릿 적합도' 태그를 붙인다 (수집에서 빼지 않고 표시만).
--   ② 페퍼릿 경쟁 인스타 2곳(셀패진·하입잭) 게시물을 담을 테이블.
--
-- 왜 이렇게 나눴나: PAP 본지와 페퍼릿이 같은 감시망을 쓴다. 본지는 사건사고·
-- 논란도 알아야 하고, 페퍼릿(Z세대 케이팝 데일리)은 그걸 다루지 않는다.
-- 수집 단계에서 지워버리면 본지가 손해를 본다 → 태그만 붙이고 소비 쪽에서 고른다.
--
-- 실행: Supabase SQL Editor 에 붙여넣기 (도메니코가 직접).

-- ── ① celeb_watch_seen 페퍼릿 태그 ─────────────────────────────────────
alter table public.celeb_watch_seen
  add column if not exists pep_blocked  boolean,
  add column if not exists pep_category text,
  add column if not exists pep_score    integer;

comment on column public.celeb_watch_seen.pep_blocked  is
  '페퍼릿이 다루지 않는 소재(열애·사건사고·논란·외모 줄세우기)면 true. PAP 알림에는 영향 없음';
comment on column public.celeb_watch_seen.pep_category is
  '페퍼릿 5종 중 하나: NEWS / NEW FACE / SCHEDULE / TODAY''S LOOK / FAVORITE. 해당 없으면 null';
comment on column public.celeb_watch_seen.pep_score    is
  '페퍼릿 우선순위 = 화제성 score + 핵심 카테고리(NEWS·NEW FACE) 보너스 3. 차단 소재는 0';

-- 페퍼릿 예약작업의 주 쿼리:
--   select ... from celeb_watch_seen
--   where pep_blocked = false and pep_category is not null
--     and created_at > now() - interval '6 hours'
--   order by pep_score desc;
create index if not exists idx_celeb_watch_pep
  on public.celeb_watch_seen (pep_score desc, created_at desc)
  where pep_blocked = false and pep_category is not null;

-- ── ② 페퍼릿 경쟁 인스타 수집 ──────────────────────────────────────────
-- 셀패진 @celeb_fashion_magazine (82.8만) · 하입잭 @hypejackmag (21.4만)
-- 근거: 40_Community/페퍼릿-경쟁사벤치마크-2026-07-17.md (2026-07-18 실측)
create table if not exists public.pepperit_watch_ig (
  id          bigserial primary key,
  handle      text        not null,
  permalink   text        not null unique,   -- 30분마다 재수집돼도 중복 적재 방지
  caption_head text,
  likes       integer     default 0,
  comments    integer     default 0,
  followers   integer,
  -- 팔로워 보정 참여도. 두 계정 규모가 4배 차이라 원점수로는 비교가 안 된다
  norm_score  numeric(10,3) default 0,
  posted_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_pepperit_watch_ig_recent
  on public.pepperit_watch_ig (posted_at desc);
create index if not exists idx_pepperit_watch_ig_hot
  on public.pepperit_watch_ig (norm_score desc, posted_at desc);

comment on table public.pepperit_watch_ig is
  '페퍼릿 경쟁 인스타 계정 게시물 감시. competitor-watch 크론이 30분마다 적재. 본지 브리핑과 분리';

-- ── 정리 (선택) — 90일 지난 감시 기록은 쓸모가 없다 ────────────────────
-- delete from public.pepperit_watch_ig where created_at < now() - interval '90 days';
