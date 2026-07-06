-- 069: IG 릴스/영상 게시물의 영상 파일 영구 보관 URL 배열
-- 실행: Supabase SQL Editor

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS videos JSONB NOT NULL DEFAULT '[]';

ALTER TABLE public.pepperit_articles
  ADD COLUMN IF NOT EXISTS videos JSONB NOT NULL DEFAULT '[]';
