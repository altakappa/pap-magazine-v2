-- 133_view_surface.sql — 조회를 화면(SSR/SPA)별로 가른다  (2026-08-22)
--
-- 왜 ─────────────────────────────────────────────────────────────────
-- 도메니코: "인스타그램에 가장 많이 되는 유입구조로 바꿔줘."
-- 그 판단의 근거를 지금은 반쪽만 갖고 있다.
--
--   분자(웹→IG 아웃클릭) 30일 1,950건 — ig_outclicks_human 에 src 별로 있다
--       ssr_article→post  833 (7일 679)
--       ssr→post          473
--       article(SPA)→*     68
--       editorial(SPA)→*   46
--   분모(그 화면을 몇 명이 봤나) — **SPA 만 있다.**
--       SSR 페이지는 조회 비콘을 아예 안 쏜다(seoRenderer 에 없음).
--
-- 그래서 "SSR 이 SPA 보다 12배" 는 **절대량 차이**일 뿐 전환율이 아니다.
-- 분모를 모르는 채로 구조를 갈아엎으면 오늘 네 번 한 실수를 다섯 번째 한다.
-- 이 마이그레이션은 그 분모를 만든다.
--
-- 무엇을 ──────────────────────────────────────────────────────────────
-- article_views · editorial_views 에 surface 를 붙인다: 'ssr' | 'spa' | NULL.
-- NULL 은 이 변경 전에 쌓인 행(전부 SPA 다 — SSR 은 쏜 적이 없다).
-- 판정할 때는 surface IS NOT NULL 인 구간만 쓴다.
--
-- 안전 ────────────────────────────────────────────────────────────────
-- 컬럼 추가뿐이다. 기존 행·인덱스·RLS 를 건드리지 않는다.
-- 코드는 이 마이그레이션 전에도 동작한다 — 42703(컬럼 없음)이면 surface 를
-- 빼고 한 번 더 넣는다. 배포 순서를 신경 쓰지 않아도 된다.

alter table public.article_views   add column if not exists surface text;
alter table public.editorial_views add column if not exists surface text;

-- 판정 쿼리는 항상 "기간 + surface" 로 센다. 그 모양에 맞춘 인덱스.
create index if not exists article_views_surface_time_idx
  on public.article_views (surface, viewed_at desc)
  where surface is not null;

create index if not exists editorial_views_surface_time_idx
  on public.editorial_views (surface, viewed_at desc)
  where surface is not null;

comment on column public.article_views.surface is
  'ssr | spa | null(=변경 전 기록, 전부 SPA). 웹→IG 전환율을 화면별로 재기 위한 분모.';
comment on column public.editorial_views.surface is
  'ssr | spa | null(=변경 전 기록, 전부 SPA). 웹→IG 전환율을 화면별로 재기 위한 분모.';
