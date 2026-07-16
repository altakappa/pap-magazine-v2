-- ============================================================================
-- PAP Magazine: 081 — profiles PII 공개 유출 차단 (보안 감사, 2026-07-16, 최우선)
-- ============================================================================
--
-- 문제(라이브 확인): profiles SELECT 정책이 USING (true) 라서 공개 anon 키
-- (브라우저에 실려 있음)만으로 profiles 전체(641행)를 조회 가능. profiles 에는
-- email·role·subscription_plan·subscription_status·token_version 이 있어
-- 전 회원의 이메일·등급(관리자 열거)·결제상태가 그대로 노출됨.
-- (실측: anon 으로 select=email,role,subscription_plan 성공, 641행)
--
-- 왜 "본인 행만" 정책으로 못 바꾸나:
--   커뮤니티(community.html)가 anon 키로 community_posts/comments/projects 에
--   profiles(display_name, avatar_url, role) 를 임베드 조인해 작성자 이름/아바타를
--   표시한다. 행 자체를 가리면 작성자 표시가 전부 깨진다.
--
-- 조치: 행 공개(RLS USING true)는 유지하되 **컬럼 단위 권한**으로 민감 컬럼을
-- anon/authenticated 에서 제거. 공개에 실제로 필요한 컬럼만 GRANT.
--   · 공개 허용: id, display_name, avatar_url, role (커뮤니티 임베드가 쓰는 것)
--   · 차단(미부여): email, name, subscription_plan, subscription_status,
--     token_version, email_language, language, country, plan, 기타 향후 컬럼 전부
--   PostgREST 는 컬럼 권한을 존중 → anon 이 profiles(email …) 요청 시 permission
--   denied. 서버(service_role)는 권한 우회하므로 로그인/웹훅 등 동작 불변. 프론트는
--   커스텀 JWT(anon 역할)라 authenticated 도 함께 revoke(방어적).
--
-- 주의: 앞으로 profiles 에 컬럼을 추가하면 그 컬럼은 기본적으로 anon 에 노출되지
-- 않는다(blanket GRANT 를 제거했으므로). 공개가 필요한 새 컬럼만 명시적으로
-- GRANT SELECT (col) ... TO anon 하면 된다. 민감 컬럼은 절대 GRANT 하지 말 것.
--
-- Idempotent: safe to re-run.

-- 1) blanket SELECT 제거 후, 공개에 필요한 컬럼만 부여.
REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (id, display_name, avatar_url, role)
  ON public.profiles TO anon, authenticated;

-- 2) RLS 정책은 그대로 유지(행 공개 — 임베드 조인용). 컬럼 권한이 민감 데이터를
--    막으므로 정책은 손대지 않는다. (참고: UPDATE/INSERT 는 이미 auth.uid()=id 제한)

COMMENT ON TABLE public.profiles IS
  '회원 프로필. 민감 컬럼(email·구독·token_version 등)은 anon/authenticated 에 컬럼 권한 미부여(081). 공개 컬럼은 id·display_name·avatar_url·role 뿐. 서버는 service_role 로 전체 접근.';
