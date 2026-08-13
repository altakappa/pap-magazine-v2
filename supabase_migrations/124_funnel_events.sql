-- ============================================================
-- 124 · funnel_events — 전환 깔때기 계측 1단계 (2026-08-13)
-- ============================================================
--
-- 왜 ─────────────────────────────────────────────────────────
-- 2026-08-12 기사 조회 계측을 붙이자 하루 661명이 사이트 안에서 기사를
-- 연다는 사실이 드러났다(에디토리얼 141의 4.7배). 그런데 그 다음이 깜깜하다.
--
--   1. 기사 조회        article_views      ✅ 있음 (하루 661)
--   2. 구독 페이지 도달  ─                  ❌ 없음  ← 이 마이그레이션이 채운다
--   3. 결제 시작        ─                  ❌ 없음  (이번엔 손대지 않는다, 아래 참조)
--   4. 결제 완료        subscriptions      ✅ 있음 (총 13건 · active 5)
--
-- 2·3 이 없으면 "661 → 13" 사이 어디서 사람이 사라지는지 알 수 없다.
-- 웹사이트의 존재 이유는 유료 구독자 증식(성장 헌법 1항)인데, 그 깔때기가
-- 통째로 계측되지 않고 있었다. Vercel Web Analytics 도 꺼져 있고(404),
-- 페이지에 붙은 분석 스크립트도 없다 — 확인했다.
--
-- ⚠️ 3단계(결제 시작)는 이번에 일부러 뺐다. 결제 코드는 PayPal 전환이
--    진행 중이고(2026-08-10~12), 저장소 규칙의 금지 구역이다. 계측을 붙이자고
--    결제 경로를 건드리는 건 순서가 틀렸다. 전환이 안정된 뒤 별건으로 한다.
--
-- 설계: step 을 text 로 열어둔다. 나중에 'checkout_start' 등을 추가할 때
-- 마이그레이션을 또 만들지 않아도 되게. 검증은 API 쪽 화이트리스트가 한다.
--
-- 되돌리기: DROP TABLE public.funnel_events;
-- ============================================================

-- STEP 1 — 표 (안전, 바로 실행)
create table if not exists public.funnel_events (
  id         bigserial primary key,
  step       text not null,                                    -- 'subscribe_view' 등
  source     text,                                             -- utm_source 또는 내부 유입 구분
  path       text,                                             -- 어느 경로에서 왔나
  user_id    uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- STEP 2 — 인덱스 (article_views 와 같은 구성)
create index if not exists idx_funnel_events_step_at
  on public.funnel_events (step, created_at desc);
create index if not exists idx_funnel_events_at
  on public.funnel_events (created_at);
create index if not exists idx_funnel_events_user_at
  on public.funnel_events (user_id, created_at desc) where user_id is not null;

-- STEP 3 — RLS. 쓰기는 서버(service_role)만, 읽기는 관리자만.
alter table public.funnel_events enable row level security;

drop policy if exists admin_read_funnel on public.funnel_events;
create policy admin_read_funnel
  on public.funnel_events for select
  using (is_admin());

-- STEP 4 — 확인
--   select count(*) from public.funnel_events;                -- 0 이어야 정상
--   select relrowsecurity from pg_class
--     where oid = 'public.funnel_events'::regclass;            -- true 여야 정상
--
-- 배포 하루 뒤 — 이 한 줄이 이번 작업의 답이다:
--   select
--     (select count(*) from article_views  where viewed_at  > now()-interval '1 day') as 기사조회,
--     (select count(*) from funnel_events
--       where step='subscribe_view' and created_at > now()-interval '1 day')          as 구독페이지도달;
