-- 091_seo_translations_body.sql
-- 아티클 본문 번역 저장 + 언어 확장 (2026-07-21)
-- ═══════════════════════════════════════════════════════════════════
-- 배경: seo_translations 는 지금까지 에디토리얼의 title/description 만
--       담았다(설명 평균 15자 — 사실상 제목 수준). 아티클은 본문이 핵심
--       콘텐츠라 body 를 저장할 자리가 필요하다.
--
-- 도메니코 결정(2026-07-21): 9개 언어 전체 + 아티클 본문까지 번역.
--   · 언어: it, fr, es, ja + zh, ru, de (ko/en 은 원본 컬럼 사용)
--   · 아티클 486건 × 7언어 = 3,402 레코드 (본문 평균 1,228자)
--
-- ⚠ SEO 주의: 대량 기계번역 본문은 구글 스팸 정책 리스크가 있다.
--    기존 코드가 에디토리얼 본문 번역을 피한 이유가 이것이다.
--    도메니코가 리스크를 인지하고 진행을 선택했으며, 완료 후
--    노출·색인 추이를 서치콘솔로 관찰하기로 한다.
--
-- 롤백:
--   alter table seo_translations drop column if exists body;

alter table seo_translations
  add column if not exists body text;

comment on column seo_translations.body is
  '번역된 본문(아티클용). 에디토리얼은 NULL — 제목·요약만 번역한다.';

-- 조회 패턴: (kind, content_id, lang) 단건 조회 + (kind, lang) 진행률 집계.
-- 유니크 제약은 080 에서 이미 (kind,content_id,lang) 로 잡혀 있어 그대로 쓴다.
create index if not exists idx_seo_translations_kind_lang
  on seo_translations (kind, lang);
