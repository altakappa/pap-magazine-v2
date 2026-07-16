-- 082: 콘텐츠 번역 저장소 — 다국어 검색 유입 2단계 (it/fr/es).
--   /en/ 은 DB 원본 필드(title_en/description_en)를 쓰지만, 그 외 언어는
--   번역 데이터가 없어 이 테이블에 저장한다. 생성은 관리자 백필 엔드포인트
--   (/api/admin/backfill-translations)가 Claude API로 제목+설명만 번역 —
--   에디토리얼은 사진 중심이라 이것으로 해당 언어 사용자에게 온전한 페이지가 된다.
--   kind+content_id+lang 유니크로 중복 방지. (079 naver_blog_drafts 패턴)
-- 실행: Supabase SQL Editor. Idempotent: 재실행 안전.

CREATE TABLE IF NOT EXISTS public.seo_translations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL,                       -- 'editorial' (향후 'article' 등)
  content_id    UUID NOT NULL,                       -- 원본 row id
  lang          TEXT NOT NULL,                       -- 'it' | 'fr' | 'es' (향후 확장)
  title         TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, content_id, lang)
);

-- SSR 페이지 렌더 시 (kind, content_id) 조회 + 백필 잔여분 스캔 최적화
CREATE INDEX IF NOT EXISTS idx_seo_translations_lookup
  ON public.seo_translations (kind, content_id);
CREATE INDEX IF NOT EXISTS idx_seo_translations_lang
  ON public.seo_translations (kind, lang);

-- 서버(service_role)만 접근. anon/authenticated 는 정책 부재로 전면 차단.
ALTER TABLE public.seo_translations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.seo_translations IS
  '다국어 SEO 번역 (제목+설명) — /it /fr /es SSR 페이지의 데이터 소스. service_role 전용(RLS).';
