-- 064: 고차원 자동화 기반 테이블 3종 (guide/AUTOMATION_PROMPTS_ADVANCED.md)
--   1) growth_events    — 이벤트·결정 원장 (13 인과가설 + 02 Decision Ledger)
--   2) weekly_briefings — 주간 경영 브리핑 (06)
--   3) trend_reports    — 트렌드 스카우트 결과 (14)
-- 실행: Supabase SQL Editor 에 붙여넣기 → Run

-- 1) 이벤트·결정 원장 ---------------------------------------------------
-- 지표 변화의 원인 후보(광고 시작, 알고리즘 변경, 발행 정책 변경 등)와
-- 운영 결정(예상 결과·검증 시점 포함)을 한 테이블에 시계열로 쌓는다.
-- daily-growth-feedback / growth-ask 가 컨텍스트로 읽어 인과 가설에 활용.
CREATE TABLE IF NOT EXISTS public.growth_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_date  DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  kind        TEXT NOT NULL DEFAULT 'event',  -- event | decision | experiment
  title       TEXT NOT NULL,                  -- 예: "IG 광고 시작 (₩15,000/일)"
  detail      TEXT,                           -- 자유 서술
  expected    TEXT,                           -- (decision) 예상 결과
  review_date DATE,                           -- (decision) 검증 시점 — 지나면 자동 회수 대상
  outcome     TEXT                            -- 검증 후 실제 결과 기록
);
CREATE INDEX IF NOT EXISTS idx_growth_events_date ON public.growth_events (event_date DESC);
CREATE INDEX IF NOT EXISTS idx_growth_events_review ON public.growth_events (review_date) WHERE outcome IS NULL;

-- 2) 주간 경영 브리핑 ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.weekly_briefings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  week_start  DATE NOT NULL,                  -- 해당 주 월요일 (KST)
  briefing    TEXT,                           -- 서사형 브리핑 (마크다운)
  metrics     JSONB,                          -- 주간 집계 스냅샷
  model       TEXT,
  UNIQUE (week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_briefings_week ON public.weekly_briefings (week_start DESC);

-- 3) 트렌드 스카우트 -----------------------------------------------------
-- RSS 수집 → 중복 제거 → PAP 적합도 점수 결과를 회차별로 저장.
CREATE TABLE IF NOT EXISTS public.trend_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  items       JSONB NOT NULL,                 -- [{title,link,source,score,angle,reason}]
  model       TEXT,
  UNIQUE (report_date)
);
CREATE INDEX IF NOT EXISTS idx_trend_reports_date ON public.trend_reports (report_date DESC);

-- RLS: 서버(service key) 전용 — 클라이언트 직접 접근 차단
ALTER TABLE public.growth_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_reports    ENABLE ROW LEVEL SECURITY;
