-- ============================================================================
-- PAP Magazine: Interstitial Ads
-- Run AFTER 000_prerequisites.sql in the Supabase SQL editor.
-- ============================================================================
--
-- Stores brand interstitial creatives (images and videos) shown to free-tier
-- members between page navigations. Standard/Premium subscribers don't see
-- these. Admin manages via /admin → 인터스티셜 광고 관리.

CREATE TABLE IF NOT EXISTS public.interstitial_ads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(10) NOT NULL DEFAULT 'image',  -- 'image' | 'video'
  src         TEXT NOT NULL,                          -- creative URL (image jpg/png/webp or video mp4)
  poster      TEXT,                                   -- poster frame (video only)
  link        TEXT,                                   -- destination URL
  brand       VARCHAR(255) NOT NULL,                  -- "GUCCI", "PAP MAGAZINE", etc.
  duration    INTEGER NOT NULL DEFAULT 3,             -- seconds shown (auto-advance)
  sort_order  INTEGER NOT NULL DEFAULT 0,             -- ascending; ties broken by created_at
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interstitial_ads_active_order
  ON public.interstitial_ads (active, sort_order, created_at);

-- updated_at auto-bump (reuses helper from 000_prerequisites.sql)
DROP TRIGGER IF EXISTS trg_interstitial_ads_updated_at ON public.interstitial_ads;
CREATE TRIGGER trg_interstitial_ads_updated_at
  BEFORE UPDATE ON public.interstitial_ads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.interstitial_ads ENABLE ROW LEVEL SECURITY;

-- Public SELECT for active ads only (clients render these directly via the API).
CREATE POLICY "Active ads are viewable by everyone"
  ON public.interstitial_ads FOR SELECT
  USING (active = true);

-- Admins can do everything (uses is_admin() helper from 000_prerequisites.sql)
CREATE POLICY "Admins can read all ads"
  ON public.interstitial_ads FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert ads"
  ON public.interstitial_ads FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update ads"
  ON public.interstitial_ads FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "Admins can delete ads"
  ON public.interstitial_ads FOR DELETE
  USING (public.is_admin());

-- ============================================================================
-- Storage bucket for ad creatives uploaded via the admin UI
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('ads', 'ads', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (creatives are meant to be displayed on the site)
CREATE POLICY "Public ad creatives readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ads');

-- Only admins can upload/replace/delete ad creatives
CREATE POLICY "Admins can upload ad creatives"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'ads' AND public.is_admin());

CREATE POLICY "Admins can update ad creatives"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'ads' AND public.is_admin());

CREATE POLICY "Admins can delete ad creatives"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'ads' AND public.is_admin());
