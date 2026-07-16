-- ============================================================================
-- PAP Magazine: 080 — cron_runs RLS 활성화 (보안 감사 후속, 2026-07-16)
-- ============================================================================
--
-- 문제: 078 에서 cron_runs 를 만들 때 RLS 를 켜지 않았다. Supabase 는 public
-- 스키마 테이블에 anon/authenticated 기본 GRANT 가 있어서, RLS 가 꺼진 테이블은
-- 프론트에 공개된 anon 키만으로 PostgREST 를 통해 전체 읽기/쓰기가 가능하다.
--   - 읽기: error 컬럼에 내부 에러 메시지(경로·설정 단서)가 담겨 정보 노출
--   - 쓰기: 임의 INSERT/DELETE 로 크론 이력 오염 → 실패 감지 무력화
--
-- 조치: RLS 활성화 + 정책 0개 = anon/authenticated 전면 차단.
-- 쓰는 쪽(api/_lib/cronGuard.js)과 읽는 쪽(admin 대시보드 API)은 모두
-- service_role 이며 service_role 은 RLS 를 우회하므로 동작 변화 없음.
-- (079_naver_blog_drafts 와 동일 패턴)
--
-- Idempotent: safe to re-run.

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.cron_runs IS
  '크론 실행 이력. cronGuard wrapper가 매 실행마다 기록. 조용한 실패 감지·admin 대시보드용. service_role 전용(RLS, 정책 없음 = anon 차단).';
