-- 079: 네이버 블로그 초안 큐 — 미전환 기사·에디토리얼을 미리 초안 생성해 저장.
--   네이버는 글쓰기 API가 없어 자동 발행 불가 → 관리자가 큐에서 복사해 수동 발행.
--   generate_next 로 1건씩 생성·저장(서버리스 maxDuration 120s 내, 초안 1건 ~90s).
--   발행하면 status='posted' 로 표시 → "미전환" 추적. (social_repurpose(072) 패턴)
--   brand+kind+source_slug 유니크로 같은 콘텐츠 중복 초안 방지.
-- 실행: Supabase SQL Editor. Idempotent: 재실행 안전.

CREATE TABLE IF NOT EXISTS public.naver_blog_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         TEXT NOT NULL,                       -- 'pap' | 'pepperit'
  kind          TEXT NOT NULL,                       -- 'article' | 'editorial'
  source_slug   TEXT NOT NULL,                       -- custom_url/slug (원본 식별)
  source_id     TEXT,                                -- 원본 row id (참조용)
  title         TEXT NOT NULL,
  body_html     TEXT NOT NULL,                       -- 이미지·체크리스트·CTA 포함 완성본
  tags          TEXT[] NOT NULL DEFAULT '{}',
  image_urls    TEXT[] NOT NULL DEFAULT '{}',
  article_url   TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',       -- draft | posted | skipped
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at     TIMESTAMPTZ,
  UNIQUE (brand, kind, source_slug)
);

-- 큐 조회(브랜드·종류·상태별 최신순) 최적화
CREATE INDEX IF NOT EXISTS idx_naver_blog_drafts_queue
  ON public.naver_blog_drafts (brand, kind, status, created_at DESC);

-- 서버(service_role)만 접근. anon/authenticated 는 정책 부재로 전면 차단.
ALTER TABLE public.naver_blog_drafts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.naver_blog_drafts IS
  '네이버 블로그 초안 큐 — 관리자가 수동 발행하기 위한 사전 생성 초안. service_role 전용(RLS).';
