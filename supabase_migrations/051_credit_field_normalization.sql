-- QA #286 — 기존 editorials/films credits의 잘못 매핑된 데이터 일괄 정정.
--
-- 정정 규칙 (review.js의 _normalizeCreditFields와 동일):
--   1. name이 @handle 패턴이고 instagram이 비어있으면 → swap
--   2. name이 https URL이고 website가 비어있으면 → swap
--   3. instagram이 https URL이고 website가 비어있으면 → swap
--   4. instagram이 @ 없이 시작하면 → '@' prefix 추가
--   5. 정규화 후 모든 필드가 비어있는 entry는 제거
--
-- 안전 가이드:
--   • 본 마이그레이션을 적용하기 전에 DRY-RUN 섹션의 SELECT를 먼저 실행해서
--     변경될 row를 확인하세요.
--   • 함수는 IMMUTABLE이며, 적용 후 자동 삭제됩니다.

-- ── 헬퍼: 단일 credit 객체 정규화 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION _pap_normalize_credit(c JSONB) RETURNS JSONB AS $$
DECLARE
  v_name  TEXT := TRIM(COALESCE(c->>'name', ''));
  v_insta TEXT := TRIM(COALESCE(c->>'instagram', ''));
  v_web   TEXT := TRIM(COALESCE(c->>'website', ''));
  v_roles JSONB := COALESCE(c->'roles', '[]'::jsonb);
BEGIN
  -- 1) name 자리에 @handle 있고 instagram 비어있으면 swap.
  IF v_insta = '' AND v_name ~ '^@[^[:space:]]+$' THEN
    v_insta := v_name;
    v_name  := '';
  END IF;

  -- 2) name 자리에 URL 있고 website 비어있으면 swap.
  IF v_web = '' AND v_name ~* '^https?://' THEN
    v_web  := v_name;
    v_name := '';
  END IF;

  -- 3) instagram 자리에 URL 있고 website 비어있으면 swap.
  IF v_web = '' AND v_insta ~* '^https?://' THEN
    v_web   := v_insta;
    v_insta := '';
  END IF;

  -- 4) instagram이 @ 없이 시작하고 URL도 아니면 '@' prefix 추가.
  IF v_insta <> '' AND v_insta !~ '^@' AND v_insta !~* '^https?://' THEN
    v_insta := '@' || LTRIM(v_insta, '@');
  END IF;

  RETURN jsonb_build_object(
    'roles',     v_roles,
    'name',      v_name,
    'instagram', v_insta,
    'website',   v_web
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 헬퍼: credits 배열 전체 정규화 (빈 entry 제거 포함) ───────────────────
CREATE OR REPLACE FUNCTION _pap_normalize_credits_array(arr JSONB) RETURNS JSONB AS $$
DECLARE
  v_result JSONB := '[]'::jsonb;
  v_item   JSONB;
  v_norm   JSONB;
BEGIN
  IF arr IS NULL OR jsonb_typeof(arr) <> 'array' THEN
    RETURN arr;
  END IF;
  FOR v_item IN SELECT jsonb_array_elements(arr) LOOP
    v_norm := _pap_normalize_credit(v_item);
    IF (v_norm->>'name')      <> ''
       OR (v_norm->>'instagram') <> ''
       OR (v_norm->>'website')   <> '' THEN
      v_result := v_result || jsonb_build_array(v_norm);
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- DRY-RUN SECTION — 적용 전 먼저 실행해서 어떤 row가 변경될지 확인 (선택).
-- 결과를 확인 후 아래 APPLY 섹션을 별도로 실행하세요.
-- ============================================================================
-- 아래 두 SELECT는 본 마이그레이션 적용 시 자동으로 실행되지 않습니다.
-- 수동 확인용 — Supabase SQL Editor에서 직접 실행:
--
-- SELECT id, title, credits, _pap_normalize_credits_array(credits) AS new_credits
-- FROM public.editorials
-- WHERE credits IS NOT NULL
--   AND credits <> _pap_normalize_credits_array(credits)
-- LIMIT 50;
--
-- SELECT id, title, credits, _pap_normalize_credits_array(credits) AS new_credits
-- FROM public.films
-- WHERE credits IS NOT NULL
--   AND credits <> _pap_normalize_credits_array(credits)
-- LIMIT 50;

-- ============================================================================
-- APPLY SECTION — 실제 정정. 본 마이그레이션 실행 시 즉시 적용됩니다.
-- ============================================================================

-- editorials 정정.
UPDATE public.editorials
SET credits = _pap_normalize_credits_array(credits)
WHERE credits IS NOT NULL
  AND jsonb_typeof(credits) = 'array'
  AND credits <> _pap_normalize_credits_array(credits);

-- films 정정.
UPDATE public.films
SET credits = _pap_normalize_credits_array(credits)
WHERE credits IS NOT NULL
  AND jsonb_typeof(credits) = 'array'
  AND credits <> _pap_normalize_credits_array(credits);

-- ── 헬퍼 함수 정리 ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS _pap_normalize_credits_array(JSONB);
DROP FUNCTION IF EXISTS _pap_normalize_credit(JSONB);
