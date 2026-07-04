-- ============================================================
-- PAP Magazine: Pinterest 자동 발행 추적 (2026-07)
--
-- editorials 를 Pinterest "EDITORIAL" 보드로 자동 발행하는
-- 크론(api/cron/sync-pinterest.js)이 진행 상태를 기록한다.
--
--   pinterest_pin_id    : 생성된 핀 ID (성공 시)
--   pinterest_synced_at : 처리 시각 (성공/영구실패 모두) — 재처리 방지
--   pinterest_error     : 영구 실패 사유 (이미지 없음/깨짐 등) — 스킵 표시
--
-- 크론은 pinterest_synced_at IS NULL 인 항목만 골라 배치 처리하므로,
-- 3000개 아카이브를 하루 수십 개씩 며칠~몇 주에 걸쳐 안전하게 소급
-- 발행한다 (신규 계정 스팸 정지 방지). 새 에디토리얼도 pin_id 가
-- NULL 이라 자동으로 큐에 들어간다.
-- ============================================================

ALTER TABLE editorials
  ADD COLUMN IF NOT EXISTS pinterest_pin_id     TEXT,
  ADD COLUMN IF NOT EXISTS pinterest_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinterest_error      TEXT;

-- 미처리 항목 조회 최적화 (크론이 매 실행마다 스캔)
CREATE INDEX IF NOT EXISTS idx_editorials_pinterest_pending
  ON editorials (published_date DESC)
  WHERE status = 'published' AND pinterest_synced_at IS NULL;

COMMENT ON COLUMN editorials.pinterest_pin_id IS 'Pinterest 핀 ID (자동발행 성공 시)';
COMMENT ON COLUMN editorials.pinterest_synced_at IS 'Pinterest 처리 시각 — 재처리 방지 플래그';
