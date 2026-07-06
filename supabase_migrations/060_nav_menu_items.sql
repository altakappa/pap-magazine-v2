-- QA #320 — 햄버거 우측 메뉴 카테고리 실운영 전환
--
-- ───────────────────────────────────────────────────────────────
-- 배경
-- ───────────────────────────────────────────────────────────────
-- 관리자 페이지 '메뉴 카테고리 관리' 는 in-memory 배열 + localStorage
-- 로만 동작하는 완전한 mock. 실제 웹사이트 햄버거 우측 메뉴는
-- pap-header.js 에 5개 항목이 하드코딩돼 있어서 관리자에서 편집해도
-- 반영이 안 됨. DB 기반 CRUD 로 전환해서 관리자 편집이 즉시 웹사이트
-- 에 반영되도록 함. 다른 QA (#310 로딩 이미지, #317 매거진) 와 동일 패턴.
--
-- ───────────────────────────────────────────────────────────────
-- 구조
-- ───────────────────────────────────────────────────────────────
-- nav_menu_items 단일 테이블. 각 row 는 햄버거 메뉴의 우측 컬럼에
-- 노출되는 링크 하나를 나타낸다. label_key 로 i18n dictionary 를
-- 참조하고 (예: 'navEditorial'), fallback 으로 label_default 를 사용.
-- link_url 은 클릭 시 이동할 경로. style 은 특별 색상 (빨강/골드) 마킹.
--
-- 하드코딩된 5개 항목을 그대로 시드해서 마이그레이션 직후 실제 웹사이트
-- 노출은 변화 없음. 관리자 편집 시부터 실제 반영.

BEGIN;

-- trigger_set_timestamp 은 이전 마이그레이션에서 정의됨.
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $func$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────
-- 1. nav_menu_items
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nav_menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label_key       VARCHAR(50),                   -- pap-i18n 딕셔너리 키. 예: 'navEditorial'. NULL 이면 fallback 사용.
  label_default   VARCHAR(80) NOT NULL,          -- 다국어 fallback (일반적으로 영어 대문자). 예: 'EDITORIAL'
  link_url        TEXT NOT NULL,                 -- 예: '/community', '/#all-editorials', 'https://external.com'
  style           VARCHAR(20) NOT NULL DEFAULT 'default',  -- 'default' | 'red' | 'gold' | 'muted'
  sort_order      INTEGER NOT NULL DEFAULT 0,    -- 낮을수록 위 (좌측)
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT nav_menu_items_style_check
    CHECK (style IN ('default', 'red', 'gold', 'muted'))
);

CREATE INDEX IF NOT EXISTS idx_nav_menu_items_active_sort
  ON nav_menu_items (is_active, sort_order)
  WHERE is_active = true;

COMMENT ON TABLE nav_menu_items IS
  'QA #320 — 햄버거 메뉴 우측 카테고리. pap-header.js 가 이 테이블에서 fetch 해 렌더.';
COMMENT ON COLUMN nav_menu_items.label_key IS
  'i18n 딕셔너리 키 (예: navEditorial). 있으면 pap-i18n 에서 언어별 번역, 없으면 label_default 사용.';
COMMENT ON COLUMN nav_menu_items.link_url IS
  '이동 URL. 정적 페이지 (/community), 해시 오버레이 (/#all-editorials), 외부 (https://...) 모두 지원.';
COMMENT ON COLUMN nav_menu_items.style IS
  '색상 스타일. default=흰색, red=강조 빨강, gold=매거진 골드, muted=회색 (비활성 느낌).';

-- ───────────────────────────────────────────────────────────────
-- 2. updated_at 트리거
-- ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_nav_menu_items_updated_at ON nav_menu_items;
CREATE TRIGGER set_nav_menu_items_updated_at
  BEFORE UPDATE ON nav_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

-- ───────────────────────────────────────────────────────────────
-- 3. RLS
-- ───────────────────────────────────────────────────────────────
ALTER TABLE nav_menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nav_menu_items public read" ON nav_menu_items;

CREATE POLICY "nav_menu_items public read"
  ON nav_menu_items
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- write 는 service_role 만.

-- ───────────────────────────────────────────────────────────────
-- 4. 시드 — 기존 pap-header.js 하드코딩 5개 그대로 이관
-- ───────────────────────────────────────────────────────────────
INSERT INTO nav_menu_items (label_key, label_default, link_url, style, sort_order, is_active)
SELECT * FROM (VALUES
  ('navCommunity', 'COMMUNITY', '/community',       'red',     10, true),
  ('navMagazine',  'MAGAZINE',  '/magazine',        'gold',    20, true),
  ('navEditorial', 'EDITORIAL', '/#all-editorials', 'default', 30, true),
  ('navArticle',   'ARTICLE',   '/articles',        'default', 40, true),
  ('navFilm',      'FILM',      '/films',           'default', 50, true)
) AS seed(label_key, label_default, link_url, style, sort_order, is_active)
WHERE NOT EXISTS (SELECT 1 FROM nav_menu_items WHERE nav_menu_items.label_default = seed.label_default);

COMMIT;
