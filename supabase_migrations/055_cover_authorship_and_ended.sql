-- QA #299 — 메인 hero 배너 목록 관리 페이지 지원 컬럼
--
-- 추가:
--   - created_by  (UUID FK profiles)  ─ 최초 등록자
--   - updated_by  (UUID FK profiles)  ─ 마지막 수정자
--   - ended_at    (TIMESTAMPTZ NULL)  ─ 운영 종료 시각 (NULL 이면 무한)
--
-- 상태 매트릭스 (시점 기준 4종):
--   공개      : is_active=true + (sched IS NULL OR sched<=NOW())
--                  + (ended IS NULL OR ended>NOW())
--   예약      : is_active=true + sched>NOW()
--                  + (ended IS NULL OR ended>NOW())
--   임시저장  : is_active=false  (mode 무관)
--   종료      : ended<=NOW()    (다른 필드 무관 — 종료가 우선)
--
-- 에디토리얼 / 뉴스 admin 의 attachAuthorship 헬퍼와 동일한 FK 패턴.

BEGIN;

ALTER TABLE cover_groups
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ended_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cover_groups_ended_active
  ON cover_groups (ended_at)
  WHERE ended_at IS NOT NULL;

COMMENT ON COLUMN cover_groups.created_by IS
  'QA #299 — initial author. profiles FK, NULL on profile delete.';
COMMENT ON COLUMN cover_groups.updated_by IS
  'QA #299 — last editor. profiles FK, NULL on profile delete.';
COMMENT ON COLUMN cover_groups.ended_at IS
  'QA #299 — run-end timestamp. NULL = no end. Past values hide the group from /api/banners regardless of is_active.';

COMMIT;
