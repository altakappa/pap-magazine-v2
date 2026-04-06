-- Migration: 004_all_content_tables.sql
-- Description: Add remaining content tables for PAP Magazine website
-- Created: 2026-04-06
-- This migration sets up tables for creators, shorts, banners, cover slides, and site settings
-- All tables have RLS enabled with public read access and admin-only write access

-- ============================================================================
-- 1. CREATORS TABLE
-- ============================================================================
-- Stores creator/contributor profiles with social links and editorial associations
CREATE TABLE IF NOT EXISTS creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100),
  instagram VARCHAR(255),
  website TEXT,
  image_url TEXT,
  editorials TEXT[], -- Array of editorial slugs/titles this creator contributed to
  bio TEXT,
  status VARCHAR(50) DEFAULT 'active', -- active, inactive, archived
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS to creators table
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read creator profiles
CREATE POLICY "creators_select_public" ON creators
  FOR SELECT
  USING (true);

-- Policy: Only admins can insert creator profiles
CREATE POLICY "creators_insert_admin" ON creators
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can update creator profiles
CREATE POLICY "creators_update_admin" ON creators
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can delete creator profiles
CREATE POLICY "creators_delete_admin" ON creators
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Create indexes for creators
CREATE INDEX idx_creators_name ON creators (name);
CREATE INDEX idx_creators_status ON creators (status);
CREATE INDEX idx_creators_instagram ON creators (instagram);

-- Add comments to creators columns
COMMENT ON TABLE creators IS 'Creator and contributor profiles for PAP Magazine';
COMMENT ON COLUMN creators.name IS 'Creator full name or display name';
COMMENT ON COLUMN creators.role IS 'Creator role (e.g., photographer, writer, editor)';
COMMENT ON COLUMN creators.instagram IS 'Instagram handle without @';
COMMENT ON COLUMN creators.website IS 'Creator website or portfolio URL';
COMMENT ON COLUMN creators.image_url IS 'Creator profile photo URL';
COMMENT ON COLUMN creators.editorials IS 'Array of editorial titles/slugs this creator contributed to';
COMMENT ON COLUMN creators.bio IS 'Creator biography or description';
COMMENT ON COLUMN creators.status IS 'Profile status: active, inactive, or archived';


-- ============================================================================
-- 2. SHORTS TABLE
-- ============================================================================
-- Stores YouTube shorts/teasers for homepage carousel
CREATE TABLE IF NOT EXISTS shorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_id VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(500) NOT NULL,
  thumbnail_url TEXT,
  status VARCHAR(50) DEFAULT 'active', -- active, inactive, archived
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS to shorts table
ALTER TABLE shorts ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read shorts
CREATE POLICY "shorts_select_public" ON shorts
  FOR SELECT
  USING (true);

-- Policy: Only admins can insert shorts
CREATE POLICY "shorts_insert_admin" ON shorts
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can update shorts
CREATE POLICY "shorts_update_admin" ON shorts
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can delete shorts
CREATE POLICY "shorts_delete_admin" ON shorts
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Create indexes for shorts
CREATE INDEX idx_shorts_status ON shorts (status);
CREATE INDEX idx_shorts_sort_order ON shorts (sort_order);
CREATE INDEX idx_shorts_youtube_id ON shorts (youtube_id);

-- Add comments to shorts columns
COMMENT ON TABLE shorts IS 'YouTube shorts and teasers for homepage carousel';
COMMENT ON COLUMN shorts.youtube_id IS 'YouTube video ID (used in embed URL)';
COMMENT ON COLUMN shorts.title IS 'Display title for the short';
COMMENT ON COLUMN shorts.thumbnail_url IS 'Custom thumbnail image URL';
COMMENT ON COLUMN shorts.status IS 'Publication status: active, inactive, or archived';
COMMENT ON COLUMN shorts.sort_order IS 'Display order in carousel (lower numbers appear first)';


-- ============================================================================
-- 3. BANNERS TABLE
-- ============================================================================
-- Stores promotional banners for homepage
CREATE TABLE IF NOT EXISTS banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_type VARCHAR(50) DEFAULT 'image', -- image, video, text
  title_ko VARCHAR(500),
  title_en VARCHAR(500),
  image_url TEXT,
  link_url TEXT,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS to banners table
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read active banners
CREATE POLICY "banners_select_public" ON banners
  FOR SELECT
  USING (
    is_active = true
    AND (start_date IS NULL OR start_date <= CURRENT_DATE)
    AND (end_date IS NULL OR end_date >= CURRENT_DATE)
  );

-- Policy: Only admins can insert banners
CREATE POLICY "banners_insert_admin" ON banners
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can update banners
CREATE POLICY "banners_update_admin" ON banners
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can delete banners
CREATE POLICY "banners_delete_admin" ON banners
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Create indexes for banners
CREATE INDEX idx_banners_is_active ON banners (is_active);
CREATE INDEX idx_banners_dates ON banners (start_date, end_date);
CREATE INDEX idx_banners_sort_order ON banners (sort_order);
CREATE INDEX idx_banners_banner_type ON banners (banner_type);

-- Add comments to banners columns
COMMENT ON TABLE banners IS 'Promotional banners displayed on homepage';
COMMENT ON COLUMN banners.banner_type IS 'Type of banner: image, video, or text';
COMMENT ON COLUMN banners.title_ko IS 'Banner title in Korean';
COMMENT ON COLUMN banners.title_en IS 'Banner title in English';
COMMENT ON COLUMN banners.image_url IS 'Banner image or background image URL';
COMMENT ON COLUMN banners.link_url IS 'Destination URL when banner is clicked';
COMMENT ON COLUMN banners.start_date IS 'Date banner becomes visible';
COMMENT ON COLUMN banners.end_date IS 'Date banner stops being visible';
COMMENT ON COLUMN banners.is_active IS 'Whether banner is currently enabled';
COMMENT ON COLUMN banners.sort_order IS 'Display order on homepage (lower numbers appear first)';


-- ============================================================================
-- 4. COVER_SLIDES TABLE
-- ============================================================================
-- Stores cover story images for homepage carousel
CREATE TABLE IF NOT EXISTS cover_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  issue VARCHAR(100),
  title VARCHAR(500) NOT NULL,
  link_url TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS to cover_slides table
ALTER TABLE cover_slides ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read active cover slides
CREATE POLICY "cover_slides_select_public" ON cover_slides
  FOR SELECT
  USING (is_active = true);

-- Policy: Only admins can insert cover slides
CREATE POLICY "cover_slides_insert_admin" ON cover_slides
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can update cover slides
CREATE POLICY "cover_slides_update_admin" ON cover_slides
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can delete cover slides
CREATE POLICY "cover_slides_delete_admin" ON cover_slides
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Create indexes for cover_slides
CREATE INDEX idx_cover_slides_is_active ON cover_slides (is_active);
CREATE INDEX idx_cover_slides_sort_order ON cover_slides (sort_order);
CREATE INDEX idx_cover_slides_issue ON cover_slides (issue);

-- Add comments to cover_slides columns
COMMENT ON TABLE cover_slides IS 'Cover story images displayed in homepage carousel';
COMMENT ON COLUMN cover_slides.image_url IS 'Cover image URL';
COMMENT ON COLUMN cover_slides.issue IS 'Magazine issue (e.g., "Issue #42", "Spring 2026")';
COMMENT ON COLUMN cover_slides.title IS 'Cover story title';
COMMENT ON COLUMN cover_slides.link_url IS 'URL to the full article or issue';
COMMENT ON COLUMN cover_slides.is_active IS 'Whether slide is visible in carousel';
COMMENT ON COLUMN cover_slides.sort_order IS 'Display order in carousel (lower numbers appear first)';


-- ============================================================================
-- 5. SITE_SETTINGS TABLE
-- ============================================================================
-- Key-value store for site-wide configuration and settings
CREATE TABLE IF NOT EXISTS site_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS to site_settings table
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read site settings
CREATE POLICY "site_settings_select_public" ON site_settings
  FOR SELECT
  USING (true);

-- Policy: Only admins can insert site settings
CREATE POLICY "site_settings_insert_admin" ON site_settings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can update site settings
CREATE POLICY "site_settings_update_admin" ON site_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Only admins can delete site settings
CREATE POLICY "site_settings_delete_admin" ON site_settings
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Add comments to site_settings columns
COMMENT ON TABLE site_settings IS 'Key-value store for site-wide configuration and settings';
COMMENT ON COLUMN site_settings.key IS 'Settings key (e.g., "site_title", "featured_editorial_count")';
COMMENT ON COLUMN site_settings.value IS 'Settings value as JSON (supports strings, numbers, booleans, objects, arrays)';
COMMENT ON COLUMN site_settings.updated_at IS 'Timestamp when setting was last updated';


-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
-- All tables have been created with:
-- - UUID primary keys with automatic generation
-- - Timestamps for tracking creation and updates
-- - Row Level Security (RLS) enabled
-- - Public read access for all tables
-- - Admin-only write access (INSERT, UPDATE, DELETE)
-- - Appropriate indexes for common queries
-- - Comprehensive column documentation
-- ============================================================================
