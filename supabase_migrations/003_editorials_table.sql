-- Create editorials table
CREATE TABLE IF NOT EXISTS public.editorials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(255),
  cover_image TEXT,
  published_date DATE,
  url TEXT,
  tags TEXT[],
  issue VARCHAR(100),
  thumbnail TEXT,
  gallery TEXT[],
  credits JSONB,
  fashion JSONB,
  status VARCHAR(50) DEFAULT 'published',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_editorials_published_date_desc
  ON public.editorials(published_date DESC);

CREATE INDEX IF NOT EXISTS idx_editorials_slug
  ON public.editorials(slug);

CREATE INDEX IF NOT EXISTS idx_editorials_status
  ON public.editorials(status);

-- Enable Row Level Security
ALTER TABLE public.editorials ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can SELECT
CREATE POLICY "Allow public select"
  ON public.editorials
  FOR SELECT
  USING (true);

-- Policy: Only admins can INSERT
CREATE POLICY "Allow admin insert"
  ON public.editorials
  FOR INSERT
  WITH CHECK (auth.uid() IN (
    SELECT user_id FROM public.admin_users
  ));

-- Policy: Only admins can UPDATE
CREATE POLICY "Allow admin update"
  ON public.editorials
  FOR UPDATE
  USING (auth.uid() IN (
    SELECT user_id FROM public.admin_users
  ))
  WITH CHECK (auth.uid() IN (
    SELECT user_id FROM public.admin_users
  ));

-- Policy: Only admins can DELETE
CREATE POLICY "Allow admin delete"
  ON public.editorials
  FOR DELETE
  USING (auth.uid() IN (
    SELECT user_id FROM public.admin_users
  ));
