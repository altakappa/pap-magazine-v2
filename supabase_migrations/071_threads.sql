-- 071: Threads API 연동 (기사 자동 게시)
--   threads_auth  — OAuth 장기 토큰 (단일 행, 60일 — 크론이 자동 연장)
--   threads_posts — 게시 이력 (기사 중복 게시 방지 + 상태 추적)
-- 실행: Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.threads_auth (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  user_id       TEXT,                 -- Threads user id (@pap_magazine)
  access_token  TEXT,                 -- 장기 토큰 (60일, th_refresh_token 으로 연장)
  expires_at    TIMESTAMPTZ,
  scope         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.threads_auth ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.threads_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  article_id   UUID REFERENCES public.articles(id) ON DELETE SET NULL,
  thread_id    TEXT,                  -- 게시된 스레드 id
  status       TEXT NOT NULL DEFAULT 'submitted',  -- submitted | published | failed
  detail       TEXT,
  UNIQUE (article_id)
);
CREATE INDEX IF NOT EXISTS idx_threads_posts_status ON public.threads_posts (status);
ALTER TABLE public.threads_posts ENABLE ROW LEVEL SECURITY;
