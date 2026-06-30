-- QA #298 — 메인 hero 배너 예약 발행
--
-- ───────────────────────────────────────────────────────────────
-- 배경
-- ───────────────────────────────────────────────────────────────
-- 에디토리얼 (QA #196) / 필름 (QA #248) 과 동일한 "활성 + 미래 예약일"
-- 패턴을 cover_groups 에도 적용. 운영자가 월간 커버 / 광고 캠페인을
-- 미리 등록해두면 지정 시각에 자동으로 hero 에 노출되도록.
--
-- ───────────────────────────────────────────────────────────────
-- 상태 매트릭스 (단일 BOOLEAN + 단일 TIMESTAMPTZ)
-- ───────────────────────────────────────────────────────────────
--   is_active = true  + scheduled_publish_at IS NULL  → 즉시 공개
--   is_active = true  + scheduled_publish_at ≤ NOW()  → 즉시 공개
--   is_active = true  + scheduled_publish_at >  NOW() → 예약 (시각 도래 시 자동 노출)
--   is_active = false                                 → 임시저장 (모드 무관)
--
-- frontend hero (/api/banners) 의 SELECT 가 위 게이트를 적용. 별도
-- cron 이 필요 없는 read-time 필터 ─ NOW() 기준이라 시간 도래 즉시
-- (캐시 만료 후 ~5분 내) 라이브에 반영됨.

BEGIN;

ALTER TABLE cover_groups
  ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ;

-- 부분 인덱스 ─ 예약된 미래 그룹은 보통 소수이므로 partial index 가
-- 가장 작고 가장 빠름. admin "예약 목록" 쿼리 & 시각 도래 체크 모두
-- 같은 인덱스를 사용.
CREATE INDEX IF NOT EXISTS idx_cover_groups_scheduled_future
  ON cover_groups (scheduled_publish_at)
  WHERE scheduled_publish_at IS NOT NULL;

COMMENT ON COLUMN cover_groups.scheduled_publish_at IS
  'QA #298 — scheduled publish timestamp. NULL or <=NOW() means immediately visible (if is_active). Future value means scheduled.';

COMMIT;
