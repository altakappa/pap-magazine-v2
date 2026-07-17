-- 085 — RLS 성능 최적화: auth.uid()/current_setting() 을 스칼라 서브쿼리로 래핑
-- (Supabase performance advisor 0003 auth_rls_initplan, 2026-07-17 감사에서 68건 검출)
--
-- 원리: RLS 식 안의 auth.uid() 는 "행마다" 재평가되지만 (select auth.uid()) 로
-- 감싸면 쿼리당 1회 평가(InitPlan)로 캐시된다. 의미는 100% 동일, 순수 성능 개선.
-- 커뮤니티/구독 테이블처럼 행이 많은 곳에서 목록 쿼리가 눈에 띄게 빨라진다.
--
-- 구현: 정책 65+3건을 수기 나열하는 대신, pg_policies 를 순회하며 기계적으로
-- 치환·재적용하는 DO 블록. 이미 래핑된 정책(" SELECT auth.uid()" 포함)은 건너뛰므로
-- 재실행해도 안전(멱등)하다.
-- 실행: Supabase SQL Editor (도메니코). 실행 후 advisor 재조회로 0건 확인.

DO $$
DECLARE
  r record;
  new_qual text;
  new_check text;
  stmt text;
  n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      -- 베어(auth.uid() / current_setting()) 호출이 있는 정책만
      AND (coalesce(qual,'') || coalesce(with_check,'')) ~ 'auth\.uid\(\)|current_setting\('
      -- 이미 래핑된 정책은 제외 (멱등 가드)
      AND (coalesce(qual,'') || coalesce(with_check,'')) !~ 'SELECT (auth\.uid\(\)|current_setting\()'
  LOOP
    new_qual  := replace(replace(r.qual,
                   'auth.uid()', '(select auth.uid())'),
                   'current_setting(''request.jwt.claims''::text, true)',
                   '(select current_setting(''request.jwt.claims''::text, true))');
    new_check := replace(replace(r.with_check,
                   'auth.uid()', '(select auth.uid())'),
                   'current_setting(''request.jwt.claims''::text, true)',
                   '(select current_setting(''request.jwt.claims''::text, true))');

    stmt := 'ALTER POLICY ' || quote_ident(r.policyname) || ' ON public.' || quote_ident(r.tablename);
    IF r.qual IS NOT NULL THEN
      stmt := stmt || ' USING (' || new_qual || ')';
    END IF;
    IF r.with_check IS NOT NULL THEN
      stmt := stmt || ' WITH CHECK (' || new_check || ')';
    END IF;

    EXECUTE stmt;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS initplan 최적화 완료: % 개 정책 재적용', n;
END $$;
