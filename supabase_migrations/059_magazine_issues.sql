-- QA #317 — Magazine 발행호 관리 실운영 데이터화
--
-- ───────────────────────────────────────────────────────────────
-- 배경
-- ───────────────────────────────────────────────────────────────
-- magazine.html 은 각 발행호(월간지)를 하드코딩된 <div class="card">
-- 로 나열하고 있었음. 새 발행호를 등록하려면 HTML 파일을 직접 수정해야
-- 해서 실운영 관리 불가능. 관리자가 다른 콘텐츠와 동일한 workflow 로
-- 관리할 수 있도록 DB + API + Admin UI 로 전환.
--
-- ───────────────────────────────────────────────────────────────
-- 구조
-- ───────────────────────────────────────────────────────────────
-- magazine_issues 단일 테이블. 이슈 번호 + 발행 년월 + 커버 이미지 +
-- 에디토리얼 수 + 링크 URL 이 core 필드. 순서 정렬은 sort_order,
-- 활성화는 is_active, LATEST 배지는 is_latest 로 관리.

BEGIN;

-- trigger_set_timestamp 헬퍼는 이전 마이그레이션에서 이미 정의됨.
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $func$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────
-- 1. magazine_issues
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS magazine_issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_number    INTEGER NOT NULL UNIQUE,   -- 예: 86 (ISSUE #86)
  title           VARCHAR(200) NOT NULL,     -- 예: "March 2026"
  issue_year      INTEGER NOT NULL,          -- 예: 2026 (연도별 섹션 그룹핑용)
  issue_month     INTEGER,                   -- 예: 3 (1-12, nullable — 특별호 등 예외)
  month_label     VARCHAR(20),               -- 예: "MAR 2026" (뱃지에 노출)
  cover_image     TEXT NOT NULL,             -- 커버 이미지 URL
  editorial_count INTEGER NOT NULL DEFAULT 0,-- 예: 19 (표기용)
  link_url        TEXT,                      -- 클릭 시 이동 URL (외부/내부)
  is_latest       BOOLEAN NOT NULL DEFAULT false, -- LATEST 배지
  is_active       BOOLEAN NOT NULL DEFAULT true,  -- 목록 노출 여부
  sort_order      INTEGER NOT NULL DEFAULT 0,     -- 같은 연도 내 순서 (높을수록 위)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_magazine_issues_active_year_sort
  ON magazine_issues (is_active, issue_year DESC, sort_order DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_magazine_issues_latest
  ON magazine_issues (is_latest)
  WHERE is_latest = true;

COMMENT ON TABLE magazine_issues IS
  'QA #317 — Magazine 발행호. magazine.html 이 이 테이블에서 fetch 해 렌더링.';
COMMENT ON COLUMN magazine_issues.issue_number IS 'ISSUE #N 배지에 노출되는 순번';
COMMENT ON COLUMN magazine_issues.month_label IS '카드 상단 배지 텍스트 (예: MAR 2026, JUL ISSUE)';
COMMENT ON COLUMN magazine_issues.is_latest IS 'LATEST 배지. 보통 최신 1건만 true.';

-- ───────────────────────────────────────────────────────────────
-- 2. updated_at 트리거
-- ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_magazine_issues_updated_at ON magazine_issues;
CREATE TRIGGER set_magazine_issues_updated_at
  BEFORE UPDATE ON magazine_issues
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

-- ───────────────────────────────────────────────────────────────
-- 3. RLS
-- ───────────────────────────────────────────────────────────────
ALTER TABLE magazine_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "magazine_issues public read" ON magazine_issues;

CREATE POLICY "magazine_issues public read"
  ON magazine_issues
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- write 는 service_role 만 (RLS bypass)

-- ───────────────────────────────────────────────────────────────
-- 4. 시드 — magazine.html 하드코딩 데이터에서 이관
--    (기존 데이터가 있으면 skip)
-- ───────────────────────────────────────────────────────────────
INSERT INTO magazine_issues (issue_number, title, issue_year, issue_month, month_label, cover_image, editorial_count, link_url, is_latest, is_active, sort_order)
SELECT * FROM (VALUES
  -- 2026
  (86, 'March 2026',    2026, 3, 'MAR 2026', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_1b257ccd25.jpg', 19, 'PAP_Magazine_March_2026.html',    true,  true, 86),
  (85, 'February 2026', 2026, 2, 'FEB 2026', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_3e0960b1dd.jpg', 23, 'PAP_Magazine_February_2026.html', false, true, 85),
  (84, 'January 2026',  2026, 1, 'JAN 2026', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_b4400e3ec5.jpg', 22, 'PAP_Magazine_January_2026.html',  false, true, 84),
  -- 2025
  (83, 'December 2025',  2025, 12, 'DEC 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_8c49128632.jpg', 22, 'PAP_Magazine_December_2025.html',  false, true, 83),
  (82, 'November 2025',  2025, 11, 'NOV 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_0281a06055.jpg', 20, 'PAP_Magazine_November_2025.html',  false, true, 82),
  (81, 'October 2025',   2025, 10, 'OCT 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_3964c677ce.jpg', 15, 'PAP_Magazine_October_2025.html',   false, true, 81),
  (80, 'September 2025', 2025, 9,  'SEP 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_aeaeff24eb.jpg', 19, 'PAP_Magazine_September_2025.html', false, true, 80),
  (79, 'August 2025',    2025, 8,  'AUG 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover2_70fd7644cd.jpg', 21, 'PAP_Magazine_August_2025.html',    false, true, 79),
  (78, 'July 2025',      2025, 7,  'JUL 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_45b4f12f70.jpg', 17, 'PAP_Magazine_July_2025.html',      false, true, 78),
  (77, 'June 2025',      2025, 6,  'JUN 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_315b741e2a.jpg', 24, 'PAP_Magazine_June_2025.html',      false, true, 77),
  (76, 'May 2025',       2025, 5,  'MAY 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_36364fafb4.jpg', 22, 'PAP_Magazine_May_2025.html',       false, true, 76),
  (75, 'April 2025',     2025, 4,  'APR 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_d9d08db712.jpg', 21, 'PAP_Magazine_April_2025.html',     false, true, 75),
  (74, 'March 2025',     2025, 3,  'MAR 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_52bc068db3.jpg', 18, 'PAP_Magazine_March_2025.html',     false, true, 74),
  (73, 'February 2025',  2025, 2,  'FEB 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover2_fec77f6045.jpg', 20, 'PAP_Magazine_February_2025.html',  false, true, 73),
  (72, 'January 2025',   2025, 1,  'JAN 2025', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_2f96d4c28f.jpg', 24, 'PAP_Magazine_January_2025.html',   false, true, 72)
) AS seed(issue_number, title, issue_year, issue_month, month_label, cover_image, editorial_count, link_url, is_latest, is_active, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM magazine_issues WHERE magazine_issues.issue_number = seed.issue_number);

COMMIT;
