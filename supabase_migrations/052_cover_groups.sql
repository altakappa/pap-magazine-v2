-- QA #295 — 메인 hero 배너를 "그룹 + 이미지(1:N)" 모델로 재설계
--
-- ───────────────────────────────────────────────────────────────
-- 배경
-- ───────────────────────────────────────────────────────────────
-- 기존 cover_slides (004_all_content_tables.sql) 는 각 슬라이드마다
-- issue/title/link_url을 1:1로 보관하는 평면 모델이었음. 실제 운영에서는
-- "JULY ISSUE / Masquerade" 호에 속한 4장의 cover 이미지를 admin이
-- 동일한 발행호+제목+링크로 4번 반복 입력하는 비효율이 발생.
--
-- 이번 마이그레이션에서 (a) 발행호/제목/링크를 한 번만 입력하는
-- cover_groups, (b) 그 안의 이미지를 N장 보관하는 cover_images 로
-- 정규화. admin UI도 이 모델에 맞게 그룹 카드 + 다중 이미지 업로드로
-- 재구성됨 (pap-admin.js renderCovers).
--
-- ───────────────────────────────────────────────────────────────
-- 호환성
-- ───────────────────────────────────────────────────────────────
-- - 기존 cover_slides 는 admin UI 가 한 번도 Supabase 와 연동되지 않은
--   상태로 남아있었음 (localStorage 만 사용). 따라서 실제 production
--   row 는 0건 ─ 안전하게 deprecated 마킹 (DROP 까지는 미루고
--   _legacy_cover_slides 로 RENAME 하여 향후 정리).
-- - frontend hero (index.html + pap-shell-bootstrap.js) 는 기존 정적
--   HTML 4 슬라이드에서 GET /api/banners 응답 기반 동적 렌더로 전환.

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. cover_groups  ── 발행호 단위 카드
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cover_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue           VARCHAR(100),                -- 예: "JULY ISSUE"
  title           VARCHAR(500) NOT NULL,       -- 예: "Masquerade"
  link_url        TEXT,                        -- 예: "/editorial/masquerade"
  sort_order      INTEGER NOT NULL DEFAULT 0,  -- 그룹 간 순서 (낮을수록 먼저)
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cover_groups_active_sort
  ON cover_groups (is_active, sort_order)
  WHERE is_active = true;

COMMENT ON TABLE cover_groups IS
  'QA #295 — 메인 hero 배너 그룹 (발행호 단위). 각 그룹은 1..N 개의 cover_images 를 포함.';

-- ───────────────────────────────────────────────────────────────
-- 2. cover_images  ── 그룹 안의 개별 이미지
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cover_images (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES cover_groups(id) ON DELETE CASCADE,
  image_url       TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,  -- 그룹 내 순서
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cover_images_group_sort
  ON cover_images (group_id, sort_order);

COMMENT ON TABLE cover_images IS
  'QA #295 — cover_groups 내부의 개별 슬라이드 이미지. group_id 1:N 관계.';

-- ───────────────────────────────────────────────────────────────
-- 3. updated_at 자동 갱신 트리거 (cover_groups)
--    (기존 마이그레이션과 동일한 패턴 ─ trigger_set_timestamp 함수가
--    프로젝트 전역에 이미 정의되어 있음)
-- ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_cover_groups_updated_at ON cover_groups;
CREATE TRIGGER set_cover_groups_updated_at
  BEFORE UPDATE ON cover_groups
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

-- ───────────────────────────────────────────────────────────────
-- 4. RLS  ── anon SELECT 만, service role 은 모두 통과
-- ───────────────────────────────────────────────────────────────
ALTER TABLE cover_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE cover_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cover_groups public read"  ON cover_groups;
DROP POLICY IF EXISTS "cover_images public read"  ON cover_images;

CREATE POLICY "cover_groups public read"
  ON cover_groups
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "cover_images public read"
  ON cover_images
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cover_groups g
      WHERE g.id = cover_images.group_id
        AND g.is_active = true
    )
  );

-- write 경로는 service_role 만 사용 ─ 별도 정책 없음 (RLS bypass)

-- ───────────────────────────────────────────────────────────────
-- 5. 기존 cover_slides → _legacy_ 로 RENAME
--    (DROP 은 다음 정리 사이클에서. 데이터가 0 row 라고 알려져
--    있더라도 직접 확인 가능하도록 보존.)
-- ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cover_slides'
  ) THEN
    ALTER TABLE cover_slides RENAME TO _legacy_cover_slides;
    COMMENT ON TABLE _legacy_cover_slides IS
      'QA #295 — cover_groups + cover_images 로 대체됨. 다음 정리 사이클에서 DROP.';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- 6. 초기 시드 ─ admin 이 첫 그룹을 등록하기 전까지 hero 가 비어
--    보이지 않도록 현재 라이브 메인 페이지의 4개 이미지를 'JULY ISSUE
--    / Masquerade' 그룹으로 채워둠. admin 이 이후 편집/교체 가능.
-- ───────────────────────────────────────────────────────────────
WITH new_group AS (
  INSERT INTO cover_groups (issue, title, link_url, sort_order, is_active)
  VALUES ('JULY ISSUE', 'Masquerade', '/editorial/masquerade', 0, true)
  RETURNING id
)
INSERT INTO cover_images (group_id, image_url, sort_order)
SELECT new_group.id, img, idx
FROM new_group,
     LATERAL (VALUES
       ('https://pap-magazine.com/img/hero/Pc_1_b784819584.jpg', 0),
       ('https://pap-magazine.com/img/hero/Pc_2_dc9e6ac138.jpg', 1),
       ('https://pap-magazine.com/img/hero/Pc_3_07bc8462e4.jpg', 2),
       ('https://pap-magazine.com/img/hero/Pc_4_d8891e2914.jpg', 3)
     ) AS seed(img, idx);

COMMIT;
