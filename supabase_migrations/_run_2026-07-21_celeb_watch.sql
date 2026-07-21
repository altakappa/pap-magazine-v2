-- ============================================================
-- 2026-07-21 · Supabase SQL Editor 실행용 (도메니코 직접 실행)
-- ① migration 084 (celeb_watch_seen 테이블)
-- ② 2026-07-20 celeb-watch 중복 draft 정리
--
-- ⚠️ 한 번에 다 실행하지 말고 STEP 순서대로. STEP 2·3은 결과를 눈으로
--    확인한 뒤 STEP 4(삭제)로 넘어간다.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- STEP 1 — celeb_watch_seen 테이블 생성 (안전, 바로 실행)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.celeb_watch_seen (
  id           BIGSERIAL PRIMARY KEY,
  signature    TEXT NOT NULL,
  title        TEXT,
  topic        TEXT,
  source_count INT,
  score        INT,
  alerted      BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_celeb_watch_seen_sig
  ON public.celeb_watch_seen(signature);
CREATE INDEX IF NOT EXISTS idx_celeb_watch_seen_created
  ON public.celeb_watch_seen(created_at DESC);

ALTER TABLE public.celeb_watch_seen ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role(서버 크론) 만 접근.

-- 확인
SELECT to_regclass('public.celeb_watch_seen') AS created;


-- ────────────────────────────────────────────────────────────
-- STEP 2 — 삭제 대상 파악 (읽기 전용). 먼저 이것만 실행해서 눈으로 확인.
--
-- celeb-watch 가 만든 draft 의 특징:
--   status='draft' + category='News'
--   + 인스타에서 온 게 아님 (source_instagram_url / instagram_imported_at NULL)
--   + 2026-07-20 생성
-- ────────────────────────────────────────────────────────────
SELECT
  date_trunc('hour', created_at) AS 시간대,
  count(*)                       AS 건수,
  min(title)                     AS 예시제목
FROM public.articles
WHERE status = 'draft'
  AND category = 'News'
  AND source_instagram_url IS NULL
  AND instagram_imported_at IS NULL
  AND created_at >= '2026-07-20 00:00:00+09'
  AND created_at <  '2026-07-21 00:00:00+09'
GROUP BY 1
ORDER BY 1;


-- ────────────────────────────────────────────────────────────
-- STEP 3 — 실제 제목 목록 (사람이 판단할 만한 게 섞였는지 확인)
-- ────────────────────────────────────────────────────────────
SELECT id, title, created_at
FROM public.articles
WHERE status = 'draft'
  AND category = 'News'
  AND source_instagram_url IS NULL
  AND instagram_imported_at IS NULL
  AND created_at >= '2026-07-20 00:00:00+09'
  AND created_at <  '2026-07-21 00:00:00+09'
ORDER BY created_at;


-- ────────────────────────────────────────────────────────────
-- STEP 4 — 삭제. STEP 2·3 결과를 확인한 뒤에만 실행.
--
-- 안전장치: BEGIN ... 으로 열고 건수를 본 뒤 COMMIT / ROLLBACK 을 고른다.
-- (Supabase SQL Editor 는 트랜잭션을 지원한다.)
-- ────────────────────────────────────────────────────────────
BEGIN;

DELETE FROM public.articles
WHERE status = 'draft'
  AND category = 'News'
  AND source_instagram_url IS NULL
  AND instagram_imported_at IS NULL
  AND created_at >= '2026-07-20 00:00:00+09'
  AND created_at <  '2026-07-21 00:00:00+09'
RETURNING id, title;

-- 위 RETURNING 건수가 예상(약 135건)과 맞으면:
--   COMMIT;
-- 예상과 다르면:
--   ROLLBACK;
--
-- ⚠️ COMMIT / ROLLBACK 중 하나를 반드시 실행해야 한다. 안 하면 잠금이 남는다.


-- ────────────────────────────────────────────────────────────
-- STEP 5 — 정리 후 확인
-- ────────────────────────────────────────────────────────────
-- SELECT status, count(*) FROM public.articles GROUP BY status ORDER BY 2 DESC;
--
-- 최신 기사 정렬 확인 (커밋 b78339b 배포 후):
-- SELECT title, published_date, created_at
-- FROM public.articles WHERE status='published'
-- ORDER BY published_date DESC, created_at DESC LIMIT 10;
