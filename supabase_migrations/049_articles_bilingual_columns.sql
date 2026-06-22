-- QA #275 hotfix6 — articles에 영어 컬럼 추가 (Instagram 자동 import에서 사용)
--
-- buildArticleRow가 title_en, content_en를 INSERT하려는데 articles 테이블에
-- 해당 컬럼이 없어서 schema cache miss로 실패함.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS title_en   TEXT,
  ADD COLUMN IF NOT EXISTS content_en TEXT;
