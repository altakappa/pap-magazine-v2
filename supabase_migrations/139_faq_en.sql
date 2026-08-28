-- 139_faq_en.sql  (2026-08-28)
-- 영문판 FAQ 칼럼 — articles.faq_en / editorials.faq_en
--
-- 왜 ─────────────────────────────────────────────────────────
-- /en/ 페이지에는 FAQ 블록도 FAQPage 스키마도 **한 번도 뜬 적이 없다**.
-- 백필이 밀린 게 아니라 코드 경로가 아예 없었다:
--
--   seoRenderer.js  faqItems = (lang==='ko') ? record.faq : (tr && tr.faq)
--   seo/article/[slug].js  "ko|en 은 DB 원본 필드, 그 외는 seo_translations"
--
-- 즉 en 은 seo_translations 를 안 읽는데(행이 0개다 — 실측 de/es/fr/it/ja/ru/zh
-- 뿐), 위 삼항식은 en 을 `tr` 쪽으로 보낸다. tr 은 언제나 null → FAQ 0.
-- editorialFaqI18nBackfill 의 TARGET_LANGS 에 'en' 이 들어 있지만 그 백필은
-- **기존 행 UPDATE 만** 하므로 en 은 영원히 대상이 0건이다.
--
-- 영어는 en 41 / ko 42 로 한국어와 거의 동률인 인용 표면이다
-- (tests/geo-citation-surface.test.js 의 10일 실측). 그 절반에 답변형 블록이
-- 없었다.
--
-- 무엇 ───────────────────────────────────────────────────────
-- en 은 이 저장소에서 일관되게 **DB 원본 칼럼 언어**다
-- (title_en · description_en · content_en). FAQ 도 같은 규칙을 따른다.
-- seo_translations 에 'en' 행을 새로 만드는 쪽은 그 불변식을 깨고
-- 이미 칼럼에 있는 영문 본문과 이중 저장이 된다.
--
-- 둘 다 nullable · 기본 null 이라 값을 채우기 전까지 기존 동작은 그대로다.
-- 채우는 것은 api/_lib/faqEnBackfill.js (기존 FAQ 크론 두 개가 남는 예산으로
-- 이어 돈다 — 새 크론을 만들지 않으므로 크론 호출 상한에 영향 0).
-- ============================================================

alter table articles   add column if not exists faq_en jsonb;
alter table editorials add column if not exists faq_en jsonb;

-- 되돌리기
--   alter table articles   drop column if exists faq_en;
--   alter table editorials drop column if exists faq_en;
