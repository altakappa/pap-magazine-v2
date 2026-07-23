-- ============================================================
-- 093 · bot_view_blocks — 봇 조회 차단 건수 일별 카운터
-- 작성: 🗓 하나 (운영 매니저) / 2026-07-23
-- 실행: 도메니코 (Supabase SQL Editor 에 통째로 붙여넣고 RUN)
--
-- 왜: editorial_views 는 봇 조회를 애초에 기록하지 않는다(2026-07-22 봇 필터).
--     그래서 "봇을 며 건 걸렀는지"를 사후에 못 센다(관측 지연). 이 테이블은
--     차단 건수만 하루 1행으로 원자적 누적해, growth-report/대시보드가 차단
--     효과를 숫자로 바로 읽게 한다. editorial_views 는 그대로 깨끗이 둔다.
--
-- 접근 주체: api/editorials/[id]/view.js 가 service_role 로만 호출한다.
--            anon/authenticated 노출 불필요 → Pattern C(완전 비공개).
-- 되돌리기: DROP FUNCTION public.bump_bot_view_block(); DROP TABLE public.bot_view_blocks;
-- ============================================================

-- ── SECTION 1 — 테이블 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bot_view_blocks (
  day           DATE PRIMARY KEY,
  blocked_count BIGINT      NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── SECTION 2 — 접근 권한 (완전 비공개) ──────────────────────
-- service_role(백엔드)만 접근. 클라이언트(anon/authenticated) 노출 차단.
REVOKE ALL ON public.bot_view_blocks FROM anon, authenticated;

-- ── SECTION 3 — RLS (Pattern C: on + 정책 없음 = service_role 만) ─
ALTER TABLE public.bot_view_blocks ENABLE ROW LEVEL SECURITY;
-- 정책 없음 의도적. service_role 은 RLS 를 우회하므로 백엔드는 정상 동작.

-- ── SECTION 4 — 원자적 증가 함수 ─────────────────────────────
-- 봇 차단 1건마다 오늘 행의 blocked_count 를 +1. 동시성 안전(ON CONFLICT).
-- SECURITY INVOKER(기본): service_role 호출이므로 테이블 쓰기 권한 충분.
-- search_path 고정: advisor 'function_search_path_mutable' 경고 예방.
CREATE OR REPLACE FUNCTION public.bump_bot_view_block()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.bot_view_blocks (day, blocked_count, updated_at)
  VALUES (CURRENT_DATE, 1, NOW())
  ON CONFLICT (day) DO UPDATE
    SET blocked_count = bot_view_blocks.blocked_count + 1,
        updated_at    = NOW();
$$;

-- 클라이언트에서 이 함수를 호출하지 못하도록 EXECUTE 회수(백엔드 전용).
REVOKE EXECUTE ON FUNCTION public.bump_bot_view_block() FROM anon, authenticated;

-- ── SECTION 5 — 검증 (실행 후 따로 RUN) ──────────────────────
-- 1) 테이블/RLS
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname='bot_view_blocks';
--    기대: relrowsecurity = true
-- 2) 함수 존재
-- SELECT proname FROM pg_proc WHERE proname='bump_bot_view_block';
-- 3) 동작 스모크 테스트 (원하면):
-- SELECT public.bump_bot_view_block();
-- SELECT * FROM public.bot_view_blocks WHERE day = CURRENT_DATE;  -- blocked_count=1
-- DELETE FROM public.bot_view_blocks WHERE day = CURRENT_DATE;    -- 테스트 흔적 제거
