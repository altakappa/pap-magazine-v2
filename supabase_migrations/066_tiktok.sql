-- 066: TikTok Content Posting API 연동
--   tiktok_auth  — OAuth 토큰 (단일 행, refresh 토큰 회전 저장)
--   tiktok_posts — 게시 이력 (에디토리얼 중복 게시 방지 + 상태 추적)
-- 실행: Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.tiktok_auth (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  open_id       TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,          -- access_token 만료 (24h)
  refresh_expires_at TIMESTAMPTZ,     -- refresh_token 만료 (365d)
  scope         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tiktok_auth ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tiktok_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  editorial_id UUID REFERENCES public.editorials(id) ON DELETE SET NULL,
  publish_id   TEXT,                  -- TikTok publish_id
  status       TEXT NOT NULL DEFAULT 'submitted',  -- submitted | published | failed
  detail       TEXT,
  UNIQUE (editorial_id)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_status ON public.tiktok_posts (status);
ALTER TABLE public.tiktok_posts ENABLE ROW LEVEL SECURITY;
