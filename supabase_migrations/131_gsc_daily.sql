-- 131 · Search Console 원본 수집 (2026-08-18)
--
-- 왜 만드나 — 2026-08-18 에 Ahrefs 의 GSC 미러로 개선할 페이지를 고르려다
-- 두 번 틀렸다. 숫자가 맞지 않았다.
--
--   국가별 클릭 합계           약 4,800
--   페이지별 표 상위 100 합계   약 400        (8%)
--   일본 클릭 992 중 키워드 표에 잡힌 것 12   (1.2%)
--
-- 사이트 전체는 주당 노출 12만인데 노출 2,000 넘는 페이지가 2개로 나왔다.
-- 근거가 8% 인 판단은 판단이 아니다. 원본을 우리가 갖는다.
--
-- 왜 두 표인가 — date x page 와 date x query 를 따로 둔다.
-- page x query 는 행이 폭발한다. 곱이 필요해지면 그때 만든다.
-- 지금 없는 필요를 위해 비용을 내지 않는다.
--
-- 기본키 = 덮어쓰기 키. GSC 는 최근 2~3일을 나중에 확정하므로 매 회차
-- 최근 며칠을 다시 긁어 덮어쓴다. 선택 키와 제약 키가 어긋나면 중복이
-- 쌓인다 (이 저장소가 이미 겪은 사고다).
CREATE TABLE IF NOT EXISTS public.gsc_page_daily (
  date        DATE    NOT NULL,
  page        TEXT    NOT NULL,
  clicks      INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  position    NUMERIC(6,2),
  PRIMARY KEY (date, page)
);

CREATE TABLE IF NOT EXISTS public.gsc_query_daily (
  date        DATE    NOT NULL,
  query       TEXT    NOT NULL,
  clicks      INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  position    NUMERIC(6,2),
  PRIMARY KEY (date, query)
);

CREATE INDEX IF NOT EXISTS idx_gsc_page_daily_date  ON public.gsc_page_daily (date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_page_daily_imp   ON public.gsc_page_daily (impressions DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_query_daily_date ON public.gsc_query_daily (date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_query_daily_imp  ON public.gsc_query_daily (impressions DESC);

ALTER TABLE public.gsc_page_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_query_daily ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.gsc_page_daily IS
  'Search Console 날짜x페이지 원본. Ahrefs 미러가 클릭의 8% 만 설명해서 직접 가져온다 (2026-08-18)';
COMMENT ON TABLE public.gsc_query_daily IS
  'Search Console 날짜x질의 원본. page x query 는 곱하지 않는다 (행 폭발)';
