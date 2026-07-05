-- ============================================================
-- PAP Magazine: 에디토리얼 원본 인스타그램 게시물 연결 (2026-07)
--
-- articles 는 048 에서 source_instagram_url 을 받았지만 editorials 는
-- 컬럼 자체가 없었다. 에디토리얼이야말로 전부 IG 게시물이 원본인데,
-- 링크가 없어서 웹 방문자를 원본 게시물(좋아요·저장·보내기가 발생하는
-- 유일한 장소)로 보내지 못했다.
--
-- 이 컬럼이 채워지면:
--   1. SSR (/editorial/:slug) — 기존 ig-funnel 모듈이 자동 활성화
--      (seoRenderer 가 record.source_instagram_url 을 이미 읽음)
--   2. SPA 오버레이 — 원본 게시물 임베드 + '친구에게 보내기'
--   3. 백필 — /api/editorials/backfill-ig 가 IG 아카이브 캡션에서
--      제목 매칭으로 소급 연결 (dry-run 기본)
-- ============================================================

ALTER TABLE editorials
  ADD COLUMN IF NOT EXISTS source_instagram_url TEXT;

COMMENT ON COLUMN editorials.source_instagram_url IS
  '원본 인스타그램 게시물 permalink — SSR/SPA의 좋아요·저장·보내기 깔때기 착지점';
