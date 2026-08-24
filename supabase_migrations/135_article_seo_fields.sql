-- 135_article_seo_fields.sql  (2026-08-24 적용 완료 — Supabase MCP)
-- CTR 회수: articles 에 검색 결과 전용 제목·설명 칼럼 추가.
-- seoRenderer 는 이미 record.seo_title / seo_description / description_en 을
-- 최우선으로 존중한다(코드가 먼저 있었고 칼럼이 없었다). 전부 nullable,
-- 기본 null 이라 기존 페이지 동작은 바뀌지 않는다. 값을 채운 기사만 바뀐다.
alter table articles add column if not exists seo_title text;
alter table articles add column if not exists seo_description text;
alter table articles add column if not exists description_en text;
