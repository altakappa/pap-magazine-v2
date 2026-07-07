-- 070: YouTube Data API 연동 (Shorts 자동 업로드)
--   youtube_auth  — OAuth 토큰 (단일 행; Google refresh_token은 회전하지 않지만
--                   재동의 시 갱신될 수 있어 DB 저장으로 통일 — tiktok_auth와 동일 패턴)
--   youtube_posts — 업로드 이력 (기사 중복 업로드 방지 + 상태 추적)
-- 실행: Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.youtube_auth (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  channel_id    TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,          -- access_token 만료 (~1h)
  scope         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.youtube_auth ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.youtube_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  article_id   UUID REFERENCES public.articles(id) ON DELETE SET NULL,
  editorial_id UUID REFERENCES public.editorials(id) ON DELETE SET NULL,  -- 향후 확장용
  video_id     TEXT,                  -- YouTube video id
  status       TEXT NOT NULL DEFAULT 'submitted',  -- submitted | published | failed
  detail       TEXT,
  UNIQUE (article_id),
  UNIQUE (editorial_id)
);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_status ON public.youtube_posts (status);
ALTER TABLE public.youtube_posts ENABLE ROW LEVEL SECURITY;
