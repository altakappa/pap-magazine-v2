-- 067: 틱톡 게시 이력에 기사(article) 지원
--   tiktok_posts.article_id — 기사 중복 게시 방지 (editorial_id 와 동일 패턴)
-- 실행: Supabase SQL Editor

ALTER TABLE public.tiktok_posts
  ADD COLUMN IF NOT EXISTS article_id UUID REFERENCES public.articles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tiktok_posts_article_id
  ON public.tiktok_posts (article_id) WHERE article_id IS NOT NULL;
