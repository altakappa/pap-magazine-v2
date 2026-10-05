-- 178 · x_posts 공개 지표 (2026-10-05)
--
-- 왜: X 본문 링크 A/B(도메니코 "일주일만 인스타링크로 시험"). 클릭은 ig_outclicks 로
-- 재지만 "도달이 눌렸는가"는 트윗 조회수가 있어야 안다. threads_posts(097)와 같은
-- 모양으로 둔다 — 24시간(stage 1)·7일(stage 2) 두 번 잰다. 수집: api/cron/x-metrics.js
--
-- ALTER ... ADD COLUMN 이라 새 GRANT 불필요. x_posts 는 service_role 전용, RLS 변경 없음.

ALTER TABLE public.x_posts
  ADD COLUMN IF NOT EXISTS views integer,
  ADD COLUMN IF NOT EXISTS likes integer,
  ADD COLUMN IF NOT EXISTS replies integer,
  ADD COLUMN IF NOT EXISTS reposts integer,
  ADD COLUMN IF NOT EXISTS quotes integer,
  ADD COLUMN IF NOT EXISTS metrics_at timestamptz,
  ADD COLUMN IF NOT EXISTS metrics_stage smallint;

COMMENT ON COLUMN public.x_posts.metrics_stage IS '1=게시 24h 뒤, 2=7일 뒤(확정), 9=조회 불가(삭제됨). x-metrics 크론';
COMMENT ON COLUMN public.x_posts.kind IS 'article | ab_body | ab_reply (2026-10-05 본문 링크 A/B 갈래) | 기타';
