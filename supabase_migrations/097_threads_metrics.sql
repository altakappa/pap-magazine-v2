-- 097 · Threads 성과 지표 + 카피 전략 메타 (2026-08-03)
--
-- 왜: 2026-07-16 재가동 이후 248건을 게시했는데 성과 데이터가 0건이다.
-- threads_posts 에는 status/detail/attempts 만 있어 "게시됐다"까지만 알고
-- "읽혔는가"는 모른다. 대화형 훅(socialHook)과 일반 AI 카피를 섞어 쓰고
-- 있는데도 어느 쪽이 나은지 판단할 근거가 하나도 없다.
--
-- 그래서 두 가지를 같은 행에 붙인다:
--   (1) 카피 전략 메타 — ai / conversational / angle / score
--       (threadsAutopost.generateThreadsText 가 이미 반환하지만 버려지던 값)
--   (2) 성과 지표 — views / likes / replies / reposts / quotes
--       (api/cron/threads-metrics 가 게시 24시간·7일 뒤에 채운다)
-- 이 둘이 한 행에 있으면 A/B 가 SQL 한 줄로 성립한다.
--
-- ALTER ... ADD COLUMN 이라 새 GRANT 불필요 (기존 테이블 권한 상속).
-- threads_posts / threads_auth 는 service_role 전용 — RLS 정책 변경 없음.

-- ───────────────────────────────────────────────────────────────
-- SECTION 1 — threads_posts: 카피 전략 메타 + 성과 지표
-- ───────────────────────────────────────────────────────────────

ALTER TABLE public.threads_posts
  ADD COLUMN IF NOT EXISTS posted_at      TIMESTAMPTZ,   -- 실제 게시 성공 시각 (실패행은 NULL)
  ADD COLUMN IF NOT EXISTS ai             BOOLEAN,       -- Claude 생성 카피인가 (false = 폴백 템플릿)
  ADD COLUMN IF NOT EXISTS conversational BOOLEAN,       -- 대화형 훅(socialHook) 경로인가
  ADD COLUMN IF NOT EXISTS angle          TEXT,          -- 대화형 훅이 고른 앵글
  ADD COLUMN IF NOT EXISTS score          NUMERIC,       -- 훅 자체 점수
  ADD COLUMN IF NOT EXISTS views          INTEGER,
  ADD COLUMN IF NOT EXISTS likes          INTEGER,
  ADD COLUMN IF NOT EXISTS replies        INTEGER,
  ADD COLUMN IF NOT EXISTS reposts        INTEGER,
  ADD COLUMN IF NOT EXISTS quotes         INTEGER,
  ADD COLUMN IF NOT EXISTS metrics_at     TIMESTAMPTZ,   -- 마지막 수집 시각
  ADD COLUMN IF NOT EXISTS metrics_stage  SMALLINT;      -- 0/NULL=미수집, 1=24시간, 2=7일(확정)

-- 기존 248건은 posted_at 이 없다. created_at 이 곧 게시 시각이므로 그대로 채운다
-- (행은 게시 직후 upsert 되므로 오차는 초 단위).
UPDATE public.threads_posts
   SET posted_at = created_at
 WHERE posted_at IS NULL AND status = 'published';

-- ───────────────────────────────────────────────────────────────
-- SECTION 2 — threads_auth: 토큰 알림 쿨다운
-- ───────────────────────────────────────────────────────────────

-- 왜: getAccessToken 은 만료 7일 전부터 자동 연장을 시도하는데, 연장이
-- 실패해도 잔여 기간이 남아 있으면 조용히 기존 토큰을 계속 쓴다. 그 상태로
-- 7일이 지나면 어느 날 갑자기 전 채널이 멎는다. 이제 알림을 보내되,
-- 10분 크론이 6시간에 한 번만 울리도록 마지막 발송 시각을 기록한다.
ALTER TABLE public.threads_auth
  ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;

-- ───────────────────────────────────────────────────────────────
-- SECTION 3 — 인덱스
-- ───────────────────────────────────────────────────────────────

-- threads-metrics 크론의 후보 조회 패턴: 게시 성공 + 미확정 + 오래된 순
CREATE INDEX IF NOT EXISTS idx_threads_posts_metrics_due
  ON public.threads_posts (metrics_stage, posted_at)
  WHERE status = 'published';

-- ───────────────────────────────────────────────────────────────
-- SECTION 4 — 검증 (적용 후 실행)
-- ───────────────────────────────────────────────────────────────

-- 1) 컬럼 12개가 붙었는가
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='threads_posts' ORDER BY ordinal_position;

-- 2) posted_at 백필 확인 (published 행에 NULL 이 없어야 한다)
-- SELECT count(*) FILTER (WHERE posted_at IS NULL) AS null_posted_at,
--        count(*) AS published
--   FROM public.threads_posts WHERE status='published';

-- 3) 수집 대기열 (지금은 전부 stage NULL 이라 24시간 지난 건 전부 뜬다)
-- SELECT count(*) FROM public.threads_posts
--  WHERE status='published' AND thread_id IS NOT NULL
--    AND coalesce(metrics_stage,0) < 2 AND posted_at < now() - interval '24 hours';

-- 4) A/B 가 성립하는지 (수집 뒤 실행 — 지금은 전부 NULL 이 정상)
-- SELECT coalesce(conversational,false) AS 대화형, count(*) AS 건수,
--        round(avg(views)) AS 평균조회, round(avg(likes),1) AS 평균좋아요,
--        round(avg(replies),2) AS 평균댓글
--   FROM public.threads_posts
--  WHERE status='published' AND metrics_stage >= 1
--  GROUP BY 1;
