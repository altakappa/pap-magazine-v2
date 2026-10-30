-- 180 — 영어판 검색 스니펫 오버라이드 (2026-10-30)
--
-- 왜: 영어 기사 페이지의 <title>·meta description 은 title_en(H1) 과 content_en
-- 첫 문장을 그대로 쓴다. 한국어판은 seo_title/seo_description 으로 검색용 문구를
-- 따로 둘 수 있는데 영어판은 그 자리가 없어서, 영어 스니펫을 고치려면 헤드라인을
-- 바꿔야 했다. GSC 9/27~10/24 실측: /en 페이지가 노출은 가장 많이 받으면서
-- CTR 0.1~1.5% (일본어판 10~18%). 제목이 검색어(뜻·레퍼런스·멤버·날짜)에 답을
-- 안 해서다. 헤드라인은 매거진의 목소리라 건드리지 않고, 검색용 문구만 따로 둔다.
--
-- 쓰임: api/_lib/seoRenderer.js — lang='en' 일 때 <title>/og:title/twitter:title/
-- meta description/JSON-LD headline·description 에만 적용. H1·본문은 그대로.
-- 비어 있으면 기존 동작(title_en, content_en 첫 문장).

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS seo_title_en        TEXT,
  ADD COLUMN IF NOT EXISTS seo_description_en  TEXT;

COMMENT ON COLUMN public.articles.seo_title_en IS
  '영어판 <title>/og:title 오버라이드 (검색용, H1 아님). 비면 title_en. 2026-10-30';
COMMENT ON COLUMN public.articles.seo_description_en IS
  '영어판 meta description/JSON-LD description 오버라이드. 비면 content_en 첫 문장. 2026-10-30';
