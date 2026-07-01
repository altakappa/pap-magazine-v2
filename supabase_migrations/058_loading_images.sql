-- QA #310 — 스플래시 로더 (Loading Splash) 실제 데이터화
--
-- ───────────────────────────────────────────────────────────────
-- 배경
-- ───────────────────────────────────────────────────────────────
-- 관리자 페이지에 '로딩 이미지 관리' 메뉴가 있었으나 완전한 mock
-- 상태였다. addLoadingImg() 는 alert("실제 운영 시 S3에 업로드")
-- 만 띄우고 하드코딩된 S3 URL 을 in-memory 배열에 push 하는 형태였고,
-- 실제 웹사이트에는 어떤 스플래시/로딩 화면도 존재하지 않았다.
--
-- 이번 QA 로:
--   1. loading_images 테이블 신설 (image_url_pc + image_url_mobile + 정렬 + 활성 플래그)
--   2. /api/loading-images (public GET) + /api/admin/loading-images (CRUD)
--   3. index.html 위에 얹히는 실제 스플래시 오버레이 신설
--      - 첫 방문 시 랜덤 이미지 1장 노출 (1~2초)
--      - sessionStorage 로 세션 내 재노출 방지
--      - prefers-reduced-motion 존중
--
-- cover_groups 구조와 비슷하지만 loading 은 그룹핑이 필요 없어
-- 단일 테이블 (1 row = 1 이미지) 로 단순화.
--
-- ───────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────
-- anon SELECT 만 (is_active = true), write 는 service_role 만.
-- cover_groups 와 동일한 정책 shape.

BEGIN;

-- 0. trigger_set_timestamp 헬퍼는 052 에서 이미 생성됨 (CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $func$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────
-- 1. loading_images  ── 스플래시 오버레이에 노출될 이미지 pool
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loading_images (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url_pc      TEXT NOT NULL,               -- 데스크톱용 (16:9 권장)
  image_url_mobile  TEXT,                        -- 모바일용 (9:16 권장, nullable — 없으면 PC 사용)
  alt_text          VARCHAR(500),                -- SEO/접근성 대체 텍스트
  sort_order        INTEGER NOT NULL DEFAULT 0,  -- 순차 노출 시 순서
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_loading_images_active_sort
  ON loading_images (is_active, sort_order)
  WHERE is_active = true;

COMMENT ON TABLE loading_images IS
  'QA #310 — 스플래시 로더 이미지 pool. 첫 방문 시 활성 이미지 중 랜덤 1장이 오버레이로 노출됨.';
COMMENT ON COLUMN loading_images.image_url_pc IS
  '데스크톱 뷰포트용 이미지 URL. 16:9 (예: 1920×1080) 권장.';
COMMENT ON COLUMN loading_images.image_url_mobile IS
  '모바일 뷰포트용 이미지 URL. 9:16 (예: 1080×1920) 권장. NULL 이면 image_url_pc 사용.';

-- ───────────────────────────────────────────────────────────────
-- 2. updated_at 자동 갱신 트리거
-- ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_loading_images_updated_at ON loading_images;
CREATE TRIGGER set_loading_images_updated_at
  BEFORE UPDATE ON loading_images
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

-- ───────────────────────────────────────────────────────────────
-- 3. RLS
-- ───────────────────────────────────────────────────────────────
ALTER TABLE loading_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loading_images public read" ON loading_images;

CREATE POLICY "loading_images public read"
  ON loading_images
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- write 는 service_role 만 (RLS bypass)

-- ───────────────────────────────────────────────────────────────
-- 4. 초기 시드 (선택) — 라이브 홈페이지의 현재 히어로 첫 이미지를
--    스플래시 pool 에 넣어 admin 이 첫 등록 전에도 로더가 표시되게 함.
--    admin 이 이후 편집/교체 가능.
-- ───────────────────────────────────────────────────────────────
INSERT INTO loading_images (image_url_pc, alt_text, sort_order, is_active)
SELECT
  'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Pc_1_b784819584.jpg',
  'PAP Magazine Cover',
  0,
  true
WHERE NOT EXISTS (SELECT 1 FROM loading_images);

COMMIT;
