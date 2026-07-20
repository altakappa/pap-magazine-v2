-- 085 — 인스타그램 성과 스냅샷 (2026-07-21)
--
-- 왜: 도메니코가 "참여가 줄어든 것 같다"고 할 때마다 검증할 데이터가 없다.
-- like_count 를 Graph API 에서 받아오면서도 어디에도 저장하지 않았고, 팔로워
-- 수도 마찬가지다. 그래서 매번 게시 빈도 같은 간접 증거로 추측해야 했다.
-- 이제부터 3시간마다 실측치를 남겨 "추측" 대신 "그래프"로 답한다.

-- ── 계정 단위: 팔로워·게시물 수 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_account_snapshot (
  id          BIGSERIAL PRIMARY KEY,
  handle      TEXT NOT NULL,
  followers   INT,
  media_count INT,
  captured_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ig_acct_snap ON public.ig_account_snapshot(handle, captured_at DESC);

-- ── 게시물 단위: 좋아요·댓글 (같은 게시물을 반복 관측) ─────────────────
-- age_hours 를 함께 남기는 이유: 게시 직후와 3일 뒤의 좋아요를 비교하면
-- 아무 의미가 없다. "게시 후 24시간 시점의 좋아요"처럼 나이를 맞춰야
-- 시기 간 비교가 성립한다 (2026-07-15 진단에서 경과시간 착시가 실제로 있었다).
CREATE TABLE IF NOT EXISTS public.ig_post_metric (
  id             BIGSERIAL PRIMARY KEY,
  post_id        TEXT NOT NULL,
  permalink      TEXT,
  media_type     TEXT,
  posted_at      TIMESTAMPTZ,
  like_count     INT,
  comments_count INT,
  age_hours      NUMERIC(8,2),
  captured_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ig_post_metric_post ON public.ig_post_metric(post_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_post_metric_posted ON public.ig_post_metric(posted_at DESC);
-- 같은 게시물을 같은 관측 시각에 두 번 넣지 않도록 (크론 재시도 방어)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_post_metric_dedup
  ON public.ig_post_metric(post_id, date_trunc('hour', captured_at));

ALTER TABLE public.ig_account_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ig_post_metric      ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role(서버 크론) 전용.

-- ── 조회 편의 뷰: 게시물별 "24시간 시점" 성과 ─────────────────────────
-- 각 게시물에서 24시간에 가장 가까운 관측 1건만 뽑는다. 주간 평균을 내면
-- "이번 주 게시물이 24시간에 평균 몇 개의 좋아요를 받았는가"가 나온다.
CREATE OR REPLACE VIEW public.ig_post_24h AS
SELECT DISTINCT ON (post_id)
  post_id, permalink, media_type, posted_at, like_count, comments_count, age_hours
FROM public.ig_post_metric
WHERE age_hours BETWEEN 12 AND 48
ORDER BY post_id, abs(age_hours - 24);
