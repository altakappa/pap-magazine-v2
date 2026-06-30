-- Critical security fix — Supabase Security Advisor 가 발견한
-- "RLS Disabled in Public" 2개 테이블에 RLS 활성화.
--
-- 배경:
--   - content_audit_log (QA #202) ─ 콘텐츠 변경 이력 (created_by/updated_by 변동)
--   - download_logs (QA #284) ─ 이미지 다운로드 로그
--   둘 다 admin-only 용도라 service_role 만 R/W 해야 하는데 RLS 가 꺼져
--   있어서 anon key 로 PostgREST /rest/v1/{table} 호출 시 외부에서 직접
--   SELECT / INSERT / UPDATE / DELETE 가능했음 (Supabase 자동 REST API).
--
-- 해결:
--   ENABLE ROW LEVEL SECURITY 만 하면 끝 ─ 별도 policy 없으면 anon /
--   authenticated 는 자동 거부. service_role 은 RLS bypass 라 그대로
--   동작. 우리 코드는 supabaseAdmin (service_role) 만 사용하므로 동작
--   변화 0.

BEGIN;

ALTER TABLE content_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_logs     ENABLE ROW LEVEL SECURITY;

-- 명시적 차단 policy 는 불필요. RLS enabled + policy 없음 = 모두 거부.
-- service_role 은 BYPASSRLS 라 자동 통과.

COMMENT ON TABLE content_audit_log IS
  'Critical security: RLS enabled. Admin audit log; service_role only.';
COMMENT ON TABLE download_logs IS
  'Critical security: RLS enabled. Image download log; service_role only.';

COMMIT;
