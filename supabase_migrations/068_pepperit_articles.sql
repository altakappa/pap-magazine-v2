-- 068: 페퍼릿(@pepperitmag) 기사 시스템 — PAP 과 완전 분리된 브랜드 테이블
--   (운영 원칙: PAP·페퍼릿 지표/콘텐츠 혼합 금지 — 별도 테이블)
-- 실행: Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.pepperit_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  category TEXT,                       -- NEWS | LOOK | MOMENT | SCHEDULE | COUPLE | NEW FACE | PHOTO | FAVORITE
  content TEXT,                        -- HTML 본문 (ko)
  tags JSONB NOT NULL DEFAULT '[]',
  thumbnail_url TEXT,
  gallery JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published',
  published_date TIMESTAMPTZ,
  source_instagram_url TEXT,
  source_instagram_post_id TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_pepperit_articles_pub
  ON public.pepperit_articles (status, published_date DESC);

ALTER TABLE public.pepperit_articles ENABLE ROW LEVEL SECURITY;
