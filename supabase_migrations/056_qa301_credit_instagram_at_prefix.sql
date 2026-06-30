-- QA #301 — credits 의 instagram 필드 @ 자동 보강 일괄 정정
--
-- 배경:
--   review.js 의 _normalizeCreditFields 는 서브미션 → 에디토리얼 변환
--   시점에 instagram 에 @ 자동 보강했지만, editorials / films 의
--   POST·PUT API 와 admin 편집 모달은 정규화를 안 거쳐서 운영자가 직접
--   편집·저장한 row 에는 @ 없는 인스타 핸들이 그대로 남음.
--
-- 본 마이그레이션:
--   1. credits JSONB 배열 안의 모든 항목 순회
--   2. instagram 값이 비어있지 않고 / URL 형태가 아니고 / @ 로 시작하지
--      않으면 → '@' + 기존값(앞 @ 중복 제거) 으로 보강
--   3. editorials + films 두 테이블 모두 적용
--
-- 안전성:
--   - 이미 @ 로 시작하는 값은 건드리지 않음 (멱등)
--   - URL 형태(https://...) 는 건드리지 않음
--   - credits 가 array 가 아닌 row 는 건드리지 않음
--   - 빈 값은 건드리지 않음

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. editorials.credits
-- ──────────────────────────────────────────────────────────────
UPDATE editorials
SET credits = (
  SELECT jsonb_agg(
    CASE
      WHEN c->>'instagram' IS NULL OR c->>'instagram' = '' THEN c
      WHEN c->>'instagram' ~ '^@' THEN c
      WHEN c->>'instagram' ~* '^https?://' THEN c
      ELSE c || jsonb_build_object(
        'instagram',
        '@' || regexp_replace(c->>'instagram', '^@+', '')
      )
    END
  )
  FROM jsonb_array_elements(credits) c
)
WHERE jsonb_typeof(credits) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(credits) c
    WHERE c->>'instagram' IS NOT NULL
      AND c->>'instagram' <> ''
      AND c->>'instagram' !~ '^@'
      AND c->>'instagram' !~* '^https?://'
  );

-- ──────────────────────────────────────────────────────────────
-- 2. films.credits — 같은 패턴 적용
-- ──────────────────────────────────────────────────────────────
UPDATE films
SET credits = (
  SELECT jsonb_agg(
    CASE
      WHEN c->>'instagram' IS NULL OR c->>'instagram' = '' THEN c
      WHEN c->>'instagram' ~ '^@' THEN c
      WHEN c->>'instagram' ~* '^https?://' THEN c
      ELSE c || jsonb_build_object(
        'instagram',
        '@' || regexp_replace(c->>'instagram', '^@+', '')
      )
    END
  )
  FROM jsonb_array_elements(credits) c
)
WHERE jsonb_typeof(credits) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(credits) c
    WHERE c->>'instagram' IS NOT NULL
      AND c->>'instagram' <> ''
      AND c->>'instagram' !~ '^@'
      AND c->>'instagram' !~* '^https?://'
  );

COMMIT;
