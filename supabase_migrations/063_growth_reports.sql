-- ============================================================
-- PAP Magazine: 데일리 성장 분석 리포트 저장소 (2026-07)
--
-- 매일 아침 크론(api/cron/daily-growth-feedback.js)이:
--   1. 성장 감사(_lib/growthAudit.js)를 실행하고
--   2. 전일 리포트와 비교해 Claude가 전문 분석·개선 피드백을 생성한 뒤
--   3. 이 테이블에 저장한다.
-- /site-analysis 대시보드가 최신 리포트 + 히스토리를 표시한다.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.growth_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  audit       JSONB NOT NULL,          -- 당일 감사 스냅샷 (수치 추적용)
  feedback    TEXT,                    -- Claude 생성 분석·개선 피드백 (마크다운)
  model       TEXT,                    -- 생성에 사용한 모델
  UNIQUE (report_date)                 -- 하루 1건 (재실행 시 upsert)
);

CREATE INDEX IF NOT EXISTS idx_growth_reports_date
  ON public.growth_reports (report_date DESC);

ALTER TABLE public.growth_reports ENABLE ROW LEVEL SECURITY;
-- service key(백엔드)만 접근 — 클라이언트 직접 접근 정책 없음.

COMMENT ON TABLE public.growth_reports IS
  '데일리 성장 분석 리포트 — 감사 스냅샷 + AI 개선 피드백 (/site-analysis)';
