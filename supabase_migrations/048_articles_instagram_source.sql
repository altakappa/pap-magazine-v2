-- ============================================================================
-- PAP Magazine: articles에 Instagram 소스 메타 컬럼 (QA #275)
-- ============================================================================
--
-- Instagram @pap_magazine 게시물을 어드민이 수동(URL 붙여넣기) 또는 자동
-- (cron 동기화)으로 article로 변환할 때, 어느 게시물에서 왔는지 추적하기
-- 위한 컬럼들. unique index는 같은 게시물이 cron 재실행 등으로 중복 import
-- 되지 않도록 방지.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS source_instagram_url     TEXT,
  ADD COLUMN IF NOT EXISTS source_instagram_post_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_imported_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_ig_post_id
  ON public.articles(source_instagram_post_id)
  WHERE source_instagram_post_id IS NOT NULL;

COMMENT ON COLUMN public.articles.source_instagram_url IS
  'Instagram 원본 게시물 URL (https://www.instagram.com/p/XXX/). 어드민이 수동으로 가져왔거나 cron이 자동 import한 경우만 채워짐.';
COMMENT ON COLUMN public.articles.source_instagram_post_id IS
  'Instagram Media ID (Graph API). cron 재실행 시 중복 import 방지에 사용.';
COMMENT ON COLUMN public.articles.instagram_imported_at IS
  'Instagram에서 import한 시점 timestamp. 어드민 list에서 "최근 import" 정렬에 사용.';
