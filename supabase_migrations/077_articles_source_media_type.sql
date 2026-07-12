-- ============================================================================
-- PAP Magazine: articles에 Instagram 원본 media_type 컬럼
-- ============================================================================
--
-- IG 자동 수집(sync-instagram cron)이 원본 게시물의 media_type을 그대로
-- 저장한다. YouTube Shorts 자동 게시 크론은 이 값이 'VIDEO'(=릴스)인
-- 기사만 대상으로 필터링 → 캐러셀 안에 섞인 영상이나 이미지 게시물이
-- Shorts로 잘못 올라가는 것을 방지.
--
-- 값:
--   'IMAGE'          — 단일 이미지 (Shorts 대상 아님)
--   'VIDEO'          — 릴스/영상 (Shorts 대상 ✅)
--   'CAROUSEL_ALBUM' — 캐러셀 (안에 영상이 있더라도 Shorts 대상 아님)
--
-- Idempotent: safe to re-run.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS source_media_type TEXT
  CHECK (source_media_type IS NULL
         OR source_media_type IN ('IMAGE','VIDEO','CAROUSEL_ALBUM'));

COMMENT ON COLUMN public.articles.source_media_type IS
  'Instagram Graph API 원본 media_type. VIDEO=릴스, CAROUSEL_ALBUM=캐러셀, IMAGE=단일 이미지. YouTube Shorts 크론이 VIDEO만 필터링하는 데 사용.';

-- YouTube 크론이 자주 조회하는 조건(source_media_type=VIDEO + status=published + 최근)
-- 성능 확보용 partial index. VIDEO row가 전체 대비 적으므로 매우 컴팩트.
CREATE INDEX IF NOT EXISTS idx_articles_video_for_shorts
  ON public.articles(published_date DESC)
  WHERE source_media_type = 'VIDEO' AND status = 'published';

-- --------------------------------------------------------------------------
-- (선택) 기존 데이터 백필 — 원본 media_type을 모르는 과거 row 를 추정.
-- 명확한 규칙:
--   videos 배열 1개 + gallery 1개 이하  → 릴스 → 'VIDEO'
--   gallery 2개 이상                    → 캐러셀 → 'CAROUSEL_ALBUM'
--   videos 없음 + gallery 1개           → 이미지 → 'IMAGE'
-- 애매하면 (videos 있고 gallery 여러 개) 캐러셀로 판정 (안전 쪽).
-- 새 IG import 는 정확한 값을 저장하므로 향후 값은 신뢰 가능.
-- --------------------------------------------------------------------------

UPDATE public.articles
   SET source_media_type = 'VIDEO'
 WHERE source_media_type IS NULL
   AND jsonb_typeof(videos) = 'array'
   AND jsonb_array_length(videos) >= 1
   AND (gallery IS NULL OR jsonb_array_length(COALESCE(gallery, '[]'::jsonb)) <= 1);

UPDATE public.articles
   SET source_media_type = 'CAROUSEL_ALBUM'
 WHERE source_media_type IS NULL
   AND gallery IS NOT NULL
   AND jsonb_array_length(gallery) >= 2;

UPDATE public.articles
   SET source_media_type = 'IMAGE'
 WHERE source_media_type IS NULL
   AND gallery IS NOT NULL
   AND jsonb_array_length(gallery) = 1
   AND (videos IS NULL OR jsonb_array_length(COALESCE(videos, '[]'::jsonb)) = 0);
