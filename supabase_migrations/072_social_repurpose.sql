-- 072: 소셜 재가공(반자동) — 샤오홍슈 / 카카오톡 채널
--   기사·에디토리얼을 각 플랫폼 톤에 맞게 자동 생성해 저장해 두고,
--   관리자가 복사해서 수동 게시한다. (공식 자동 게시 API가 없는 플랫폼 대응)
--   social_repurpose — (대상, 플랫폼)당 1행. 제목/본문/해시태그/선택 이미지 보관.
-- 실행: Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.social_repurpose (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   TEXT NOT NULL,                       -- 'article' | 'editorial'
  target_id     UUID NOT NULL,
  platform      TEXT NOT NULL,                        -- 'xiaohongshu' | 'kakao'
  title         TEXT,
  body          TEXT,
  hashtags      TEXT[]  NOT NULL DEFAULT '{}',
  image_urls    TEXT[]  NOT NULL DEFAULT '{}',
  lang          TEXT,                                 -- 'zh' | 'ko'
  status        TEXT NOT NULL DEFAULT 'draft',        -- draft | posted
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_social_repurpose_target
  ON public.social_repurpose (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_social_repurpose_platform
  ON public.social_repurpose (platform, status);

ALTER TABLE public.social_repurpose ENABLE ROW LEVEL SECURITY;
