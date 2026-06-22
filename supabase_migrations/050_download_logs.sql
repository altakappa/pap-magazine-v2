-- QA #277 — 에디토리얼 이미지 다운로드 이력 기록.
-- 누가, 언제, 어떤 콘텐츠/이미지를 받았는지 추적해서 저작권 분쟁 시
-- 출처 확인 + Phase 2(월별 다운로드 제한) 기반 데이터로 사용.

CREATE TABLE IF NOT EXISTS public.download_logs (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email        TEXT,
  content_type      TEXT NOT NULL CHECK (content_type IN ('cover','gallery','editorial-zip','article-thumb')),
  content_id        TEXT,                 -- editorial_id / article_id 등
  content_slug      TEXT,
  image_url         TEXT,                 -- 다운로드된 실제 이미지 URL
  file_name         TEXT,                 -- 회원 식별자 포함된 파일명
  ip_address        TEXT,
  user_agent        TEXT,
  consented         BOOLEAN DEFAULT FALSE, -- 약관 동의 여부
  downloaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_download_logs_user_id    ON public.download_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_download_logs_content    ON public.download_logs(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_download_logs_dl_at      ON public.download_logs(downloaded_at DESC);
