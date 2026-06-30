-- QA #300 — 이미지 ↔ 착장 크레딧 매핑 정합성 진단 (read-only)
--
-- 사용:
--   1) Supabase SQL Editor 에 통째 붙여넣어 실행
--   2) 결과로 나오는 row 들이 fix 대상 ─ admin 에서 다시 열어
--      이미지/크레딧을 직접 확인 후 저장하면 PATCH 핸들러가 자동 재정렬
--
-- 이 스크립트는 DROP / UPDATE 없이 SELECT 만 수행 ─ 안전.

-- ──────────────────────────────────────────────────────────────
-- 1. 서브미션 측 ─ description.fashion.imageCredits 키 인덱스가
--    file_urls 길이를 초과하는 row
-- ──────────────────────────────────────────────────────────────
WITH credit_indexes AS (
  SELECT
    s.id,
    s.title,
    s.status,
    s.created_at,
    COALESCE(array_length(s.file_urls, 1), 0)             AS image_count,
    substring(k FROM 'img_(\d+)$')::int                   AS credit_idx
  FROM submissions s,
       LATERAL jsonb_object_keys(s.description->'fashion'->'imageCredits') AS k
  WHERE s.description ? 'fashion'
    AND s.description->'fashion' ? 'imageCredits'
)
SELECT
  id,
  title,
  status,
  created_at::date AS created_date,
  image_count,
  MAX(credit_idx)  AS max_credit_idx,
  COUNT(*)         AS credit_count,
  '⚠ submission: max credit idx > image count' AS issue
FROM credit_indexes
GROUP BY id, title, status, created_at, image_count
HAVING MAX(credit_idx) > image_count

UNION ALL

-- ──────────────────────────────────────────────────────────────
-- 2. 에디토리얼 측 ─ fashion.imageCredits 키 인덱스가 gallery
--    길이를 초과하는 row (review.js 통해 만들어진 후 운영자가
--    이미지 변경한 case)
-- ──────────────────────────────────────────────────────────────
SELECT
  e.id,
  e.title,
  e.status,
  e.published_date::date AS created_date,
  COALESCE(jsonb_array_length(
    CASE jsonb_typeof(e.gallery)
      WHEN 'array' THEN e.gallery
      ELSE '[]'::jsonb
    END
  ), 0) AS image_count,
  MAX(substring(k FROM 'img_(\d+)$')::int) AS max_credit_idx,
  COUNT(*) AS credit_count,
  '⚠ editorial: max credit idx > gallery length' AS issue
FROM editorials e,
     LATERAL jsonb_object_keys(
       CASE jsonb_typeof(e.fashion->'imageCredits')
         WHEN 'object' THEN e.fashion->'imageCredits'
         ELSE '{}'::jsonb
       END
     ) AS k
WHERE e.fashion ? 'imageCredits'
GROUP BY e.id, e.title, e.status, e.published_date, e.gallery
HAVING MAX(substring(k FROM 'img_(\d+)$')::int) > COALESCE(jsonb_array_length(
  CASE jsonb_typeof(e.gallery)
    WHEN 'array' THEN e.gallery
    ELSE '[]'::jsonb
  END
), 0)

ORDER BY created_date DESC;

-- ──────────────────────────────────────────────────────────────
-- 결과 해석
-- ──────────────────────────────────────────────────────────────
-- - 결과가 0 row 이면 ✅ 정합성 OK (인덱스 어긋난 row 없음)
-- - row 가 보이면 그 id 를 admin 화면에서 다시 열어 이미지 / 착장
--   크레딧을 검토 + 저장하면 QA #215 (서버 PATCH 핸들러) / QA #300
--   (클라이언트 _galleryDelete/_galleryReorder) fix 가 자동 재정렬
-- - 보다 적극적인 정정이 필요하면 별도 마이그레이션 작성
--   (지금은 read-only 진단 스크립트로 일단 영향 범위만 파악)
