-- =============================================
-- PAP Magazine: Full Database Migration
-- Tables + All Data (141 Films + 317 Articles)
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Create films table
CREATE TABLE IF NOT EXISTS public.films (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  youtube_id TEXT,
  thumbnail_url TEXT,
  published_date DATE,
  categories TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  slug TEXT UNIQUE,
  credits JSONB DEFAULT '[]',
  status TEXT DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create articles table
CREATE TABLE IF NOT EXISTS public.articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  slug TEXT UNIQUE,
  published_date DATE,
  category TEXT,
  tags JSONB DEFAULT '[]',
  thumbnail_url TEXT,
  hero_image_url TEXT,
  content TEXT,
  gallery JSONB DEFAULT '[]',
  credits JSONB DEFAULT '[]',
  custom_url TEXT,
  status TEXT DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Auto-update triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS films_updated ON public.films;
CREATE TRIGGER films_updated BEFORE UPDATE ON public.films
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS articles_updated ON public.articles;
CREATE TRIGGER articles_updated BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_films_status ON public.films(status);
CREATE INDEX IF NOT EXISTS idx_films_date ON public.films(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_films_slug ON public.films(slug);
CREATE INDEX IF NOT EXISTS idx_articles_status ON public.articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_date ON public.articles(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON public.articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_category ON public.articles(category);

-- 5. RLS Policies
ALTER TABLE public.films ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS films_public_read ON public.films;
CREATE POLICY films_public_read ON public.films FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS films_service_all ON public.films;
CREATE POLICY films_service_all ON public.films FOR ALL USING (
  current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
);

DROP POLICY IF EXISTS articles_public_read ON public.articles;
CREATE POLICY articles_public_read ON public.articles FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS articles_service_all ON public.articles;
CREATE POLICY articles_service_all ON public.articles FOR ALL USING (
  current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
);

-- 6. Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;


