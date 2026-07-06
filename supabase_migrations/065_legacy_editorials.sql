-- 065: 레거시 에디토리얼 대량 임포트 (IG 아카이브 2,000+ → 개별 페이지)
--   1) editorials.legacy — IG 시절 임포트분 표시 (무결성 검사·핀터레스트 제외용)
--   2) legacy_import_state — 크론 페이지네이션 커서 (단일 행)
-- 실행: Supabase SQL Editor

ALTER TABLE public.editorials ADD COLUMN IF NOT EXISTS legacy BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_editorials_legacy ON public.editorials (legacy) WHERE legacy = true;

CREATE TABLE IF NOT EXISTS public.legacy_import_state (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor_after TEXT,                    -- Graph API paging.cursors.after
  scanned     INT NOT NULL DEFAULT 0,   -- 훑은 IG 게시물 수
  imported    INT NOT NULL DEFAULT 0,   -- 에디토리얼로 생성된 수
  skipped     INT NOT NULL DEFAULT 0,   -- 비에디토리얼/중복 스킵
  done        BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.legacy_import_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.legacy_import_state ENABLE ROW LEVEL SECURITY;
