-- 083: articles.faq — AEO(답변엔진 최적화) FAQ 블록.
--   근거: AI 답변의 ~60%가 FAQ 구조화 콘텐츠에서 나온다 (2026-07 AEO/GEO 교육자료).
--   기사 자동생성(sync-instagram)이 질문 3개+자기완결 답변을 함께 생성해 저장하고,
--   SSR(seoRenderer)이 본문 하단 FAQ 섹션 + FAQPage JSON-LD 로 렌더링한다.
--   형식: [{"q":"질문","a":"답변"}, ...] (한국어, 최대 5개)
-- 실행: Supabase SQL Editor. Idempotent: 재실행 안전.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS faq JSONB;

COMMENT ON COLUMN public.articles.faq IS
  'AEO FAQ 블록 [{"q","a"}] — 기사 생성 시 Claude 가 함께 생성. SSR 이 FAQPage 스키마로 노출.';
