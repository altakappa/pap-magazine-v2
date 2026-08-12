-- ============================================================
-- 123 · article_views — 기사 조회 계측 (2026-08-12)
--      Supabase SQL Editor 에서 **도메니코가 직접 실행**
-- ============================================================
--
-- 왜 필요한가 ────────────────────────────────────────────────
-- 실측(2026-08-12):
--     발행 기사              2,338편 (최근 30일 신규 1,891편)
--     articles.view_count 합       0
--     조회 0인 기사 비율         100%
--     기사 리액션(좋아요) 30일      2건
--
-- view_count 컬럼은 있는데 **올려주는 코드가 어디에도 없다.** 읽기만 한다
-- (admin 정렬·ops 대시보드·growthAudit). 즉 기사 쪽은 분모가 없다.
--
-- 분모가 없으면 참여 개선을 판정할 수 없다. "좋아요 2건"이 나쁜 건지조차
-- 알 수 없다 — 2,000명이 보고 2명이 눌렀으면 문제고, 20명이 보고 2명이
-- 눌렀으면 훌륭하다. 에디토리얼은 editorial_views 로 30일 11,003건이 잡히는데
-- 기사만 깜깜하다.
--
-- (오늘의 교훈과 같은 뿌리 — 보이지 않는 것과 없는 것은 다르다.)
--
-- 설계: editorial_views 를 그대로 미러링한다. 같은 모양이어야 같은 쿼리로
-- 비교할 수 있다. 다만 RLS 정책은 더 좁게 간다 — 서버(service_role)만 쓰므로
-- anon INSERT 정책을 만들지 않는다 (2026-07 보안 감사 A-2 의 방향).
--
-- 되돌리기: DROP TABLE public.article_views;  (데이터만 사라지고 다른 곳 영향 없음)
-- ============================================================

-- STEP 1 — 표 만들기 (안전, 바로 실행)
create table if not exists public.article_views (
  id          bigserial primary key,
  article_id  uuid references public.articles(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  viewed_at   timestamptz not null default now()
);

-- STEP 2 — 인덱스 (editorial_views 와 같은 구성)
create index if not exists idx_article_views_article_at
  on public.article_views (article_id, viewed_at desc);
create index if not exists idx_article_views_at
  on public.article_views (viewed_at);
create index if not exists idx_article_views_user_at
  on public.article_views (user_id, viewed_at desc) where user_id is not null;

-- STEP 3 — RLS. 쓰기는 서버(service_role)만, 읽기는 관리자만.
--          service_role 은 RLS 를 우회하므로 별도 정책이 필요 없다.
alter table public.article_views enable row level security;

drop policy if exists admin_read_article_view on public.article_views;
create policy admin_read_article_view
  on public.article_views for select
  using (is_admin());

-- STEP 4 — 확인 (결과를 눈으로 볼 것)
--   select count(*) from public.article_views;              -- 0 이어야 정상
--   select relrowsecurity from pg_class
--     where oid = 'public.article_views'::regclass;         -- true 여야 정상
--
-- 배포 후 하루 지나서:
--   select count(*) from public.article_views
--    where viewed_at > now() - interval '1 day';            -- 0 이면 프론트 호출 확인
