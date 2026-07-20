-- 088 — ig_outclicks_human 뷰 권한 봉인 (2026-07-21)
--
-- 087 이 만든 뷰에 구멍이 있다. Supabase 보안 린터 ERROR:
--   "View public.ig_outclicks_human is defined with the SECURITY DEFINER property"
--
-- 원인: CREATE VIEW 는 기본이 security_invoker=false 라 뷰가 소유자(postgres)
-- 권한으로 실행된다. 원본 ig_outclicks 는 RLS 가 켜져 있고 정책이 없어서
-- service_role 만 읽을 수 있는데, 뷰를 거치면 그 RLS 가 통째로 우회된다.
-- 게다가 Supabase 기본 grant 로 anon·authenticated 에 SELECT 가 붙어 있어
-- 공개 anon 키만 있으면 /rest/v1/ig_outclicks_human 으로 클릭 로그 전체
-- (ip_hash·target_url·referrer_path·device_type)를 긁을 수 있는 상태였다.
--
-- 즉 087 은 지표 오독을 막으려다 개인정보 로그를 공개해버렸다.
-- 뷰를 만들 때 원본 테이블의 RLS 를 상속하는지 항상 확인할 것.
--
-- 조치 (되돌리기 쉬운 권한 축소만, 데이터는 건드리지 않는다):
--   1) security_invoker=on — 호출자 권한으로 실행 → 원본 RLS 그대로 상속.
--      service_role 은 RLS 를 우회하므로 리포트 조회는 영향 없음.
--   2) anon·authenticated 의 모든 권한 회수 — 이중 방어.
--      (뷰에 붙은 INSERT/UPDATE/DELETE grant 도 함께 정리. 뷰는 단순 SELECT
--       뷰라 쓰기가 실제로 되지는 않지만 권한을 남겨둘 이유가 없다.)

ALTER VIEW public.ig_outclicks_human SET (security_invoker = on);

REVOKE ALL ON public.ig_outclicks_human FROM anon;
REVOKE ALL ON public.ig_outclicks_human FROM authenticated;

GRANT SELECT ON public.ig_outclicks_human TO service_role;

COMMENT ON VIEW public.ig_outclicks_human IS
  '크롤러 오염을 제거한 웹→IG 아웃클릭. 지표·리포트는 이 뷰를 쓴다 (087). '
  'security_invoker=on + service_role 전용 (088) — 원본 RLS 를 상속한다.';
