-- ──────────────────────────────────────────────────────────────────────
-- 181 — 2026-11-07 보안감사: anon 쓰기 차단 + 뷰/그랜트 정리
--
-- ■ 무슨 문제였나
-- 웹사이트에 박혀 있는 공개 anon 키(frontend/auth.html)만으로 **로그인도 없이**
-- 아래 5개 표에 행을 넣을 수 있었다. 테이블 GRANT 와 `with_check: true` INSERT
-- 정책이 동시에 열려 있었기 때문이다. RLS 가 켜져 있어도 정책이 `true` 면 아무
-- 조건 없이 통과한다 — RLS 를 켠 것만으로 안전하다고 착각하기 쉬운 지점이다.
--
--   affiliate_clicks         → 어필리에이트 클릭 지표 위조 (브랜드 리포트 오염)
--   community_badges         → 아무나 아무에게 배지 부여
--   community_notifications  → 제품 UI 안의 알림 위조 (피싱 경로)
--   community_post_views     → 조회수 조작
--   editorial_views          → 조회수 조작 → 트렌딩·골든부스트 랭킹 조작
--
-- 공통으로 무한 INSERT 가 가능해 DB 용량·비용 공격에도 열려 있었다.
--
-- ■ 고치는 방향
-- 다섯 표는 전부 **서버(service_role)만 쓰면 되는 표**다. service_role 은 RLS 를
-- 우회하므로 정책을 지우고 그랜트를 회수해도 서버 경로는 그대로 동작한다.
--
-- 유일한 예외가 community_post_views 였다 — 프런트가 anon 키로 직접 INSERT 하고
-- 있었다(`SB.recordView`). 그래서 이 마이그레이션과 **같은 커밋에서** 서버
-- 엔드포인트 `POST /api/community/posts/:id/view` 를 만들고 프런트를 그쪽으로
-- 돌렸다. 순서가 중요하다: 코드가 먼저 배포돼야 조회수가 끊기지 않는다.
--
-- ■ is_admin() 은 건드리지 않는다 (감사 S-9 재분류)
-- 어드바이저는 `public.is_admin()` 이 anon·authenticated 에 EXECUTE 허용이라고
-- 경고한다. 그런데 이 함수는 `community_posts` 의 "Admins can manage all posts"
-- 정책 본문에서 쓰인다. 정책은 **호출한 역할의 권한으로** 평가되므로 EXECUTE 를
-- 회수하면 그 역할의 해당 표 접근이 permission denied 로 깨진다. 즉 이건 RLS 가
-- 지탱하는 구조상 필요한 권한이고, 노출되는 정보는 호출자 자신의 관리자 여부뿐이다.
-- 실피해가 없으므로 그대로 둔다. (지우려면 정책에서 is_admin() 을 먼저 걷어내야 한다.)
--
-- ■ 적용 방법
-- Supabase SQL Editor 에 통째로 붙여 Run.
--   https://supabase.com/dashboard/project/igcazquhkwxtqsaqpznx/sql/new
-- 전부 멱등(IF EXISTS)이라 두 번 돌려도 안전하다.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- SECTION 1 — 무조건 통과(with_check true) INSERT 정책 삭제
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_click"            ON public.affiliate_clicks;
DROP POLICY IF EXISTS "System can award badges"      ON public.community_badges;
DROP POLICY IF EXISTS "System can create notifications" ON public.community_notifications;
DROP POLICY IF EXISTS "System can record views"      ON public.community_post_views;
DROP POLICY IF EXISTS "anon_insert_view"             ON public.editorial_views;

-- ───────────────────────────────────────────────────────────────
-- SECTION 2 — 테이블 GRANT 회수 (정책을 지워도 그랜트가 남으면 다음 사람이
--             정책 하나를 추가하는 순간 다시 열린다 — 두 겹 다 닫는다)
-- ───────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.affiliate_clicks        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_badges        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_notifications FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_post_views    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.editorial_views         FROM anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- SECTION 3 — SECURITY DEFINER 뷰 2개의 공개 읽기 차단 (감사 S-8)
--   어드바이저 ERROR 등급. 두 뷰는 RLS 를 우회해 주차별 AI·소셜 유입 지표를
--   보여준다. 개인정보는 없지만 영업 지표다. 소비자는 service_role(관리자
--   대시보드·Cowork)뿐이라(코드 전수 확인) 회수해도 끊기는 화면이 없다.
-- ───────────────────────────────────────────────────────────────
REVOKE ALL ON public.ai_inflow_weekly       FROM anon, authenticated;
REVOKE ALL ON public.social_inclicks_health FROM anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- SECTION 4 — profiles 의 DELETE 그랜트 회수 (감사 S-13)
--   DELETE 정책이 없어 지금은 RLS 가 막는다. 하지만 그랜트가 남아 있으면
--   누가 DELETE 정책 하나를 추가하는 순간 회원이 회원 행을 지울 수 있게 된다.
--   회원 삭제는 api/admin/member-delete.js(service_role · 대표 관리자 전용)만 한다.
-- ───────────────────────────────────────────────────────────────
REVOKE DELETE ON public.profiles FROM anon, authenticated;

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- SECTION 5 — 검증 (Run 후 아래를 따로 실행해 결과를 확인)
--   기대: 첫 질의 0행, 둘째 질의 모든 열 false
-- ───────────────────────────────────────────────────────────────
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname='public'
--    AND tablename IN ('affiliate_clicks','community_badges','community_notifications',
--                      'community_post_views','editorial_views')
--    AND cmd IN ('INSERT','ALL');
--
-- SELECT c.relname,
--        has_table_privilege('anon', c.oid, 'INSERT')          AS anon_ins,
--        has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_ins,
--        has_table_privilege('anon', c.oid, 'SELECT')          AS anon_sel
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public'
--    AND c.relname IN ('affiliate_clicks','community_badges','community_notifications',
--                      'community_post_views','editorial_views',
--                      'ai_inflow_weekly','social_inclicks_health')
--  ORDER BY 1;
