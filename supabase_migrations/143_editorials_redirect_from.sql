-- ──────────────────────────────────────────────────────────────────────
-- PAP Magazine — 143_editorials_redirect_from.sql
--
-- editorials 에 redirect_from(text[]) 추가 — 옛 슬러그 보존 301.
--
-- 배경: articles 에는 이미 redirect_from(text[]) 이 있고
-- api/seo/article/[slug].js 가 이를 조회해 옛 /article/<old> URL 을
-- 정규 슬러그로 301 넘긴다. editorials 에는 이 컬럼이 없어서, 화보의
-- 옛 슬러그를 고칠 때마다 vercel.json 리다이렉트를 손으로 추가하고
-- 배포해야 했다 (2026-09-03 DR81 fisher-s-daughters 가 그 사례).
-- 이 컬럼이 생기면 코드가 DB 만 보고 해석하므로 배포 없이 처리된다.
--
-- 컬럼 추가라 새 GRANT 는 필요 없다(_TEMPLATE.sql SECTION 3 참조 —
-- ALTER TABLE ... ADD COLUMN 은 테이블의 기존 grant 를 물려받는다).
-- ──────────────────────────────────────────────────────────────────────

-- SECTION 1 — Schema
ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS redirect_from TEXT[];

-- SECTION 2 — Index
-- SSR 은 redirect_from @> ARRAY['<slug>'] (supabase-js .contains) 로
-- 조회한다. 옛 슬러그로 들어온 요청마다 전체 테이블(발행 2,490+건)을
-- 훑지 않도록 GIN 인덱스를 건다.
CREATE INDEX IF NOT EXISTS idx_editorials_redirect_from
  ON public.editorials USING GIN (redirect_from);

-- SECTION 6 — Verification
-- 1) 컬럼 존재 확인
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='editorials'
--    AND column_name='redirect_from';
--
-- 2) 인덱스 확인
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname='public' AND tablename='editorials'
--    AND indexname='idx_editorials_redirect_from';
--
-- 3) DR81 백필 예시 (도메니코가 실행 — 값은 실제 옛 슬러그로 교체):
-- UPDATE public.editorials
--    SET redirect_from = ARRAY['berlin-music-video-awards-2022']
--  WHERE slug = '<fisher-s-daughters 의 현재 정규 슬러그>';
