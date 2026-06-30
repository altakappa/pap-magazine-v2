-- QA #296 — 메인 hero 배너 PC/모바일 이미지 분리
--
-- ───────────────────────────────────────────────────────────────
-- 배경
-- ───────────────────────────────────────────────────────────────
-- 052 에서 cover_groups + cover_images(1:N) 모델을 도입했지만
-- cover_images.image_url 한 컬럼만 있어서 PC 와 모바일 디바이스별
-- 다른 크롭 / 비율의 이미지를 사용할 수 없었음. 대표 매거진 디자인은
-- PC = 가로 비율(16:9), 모바일 = 세로 비율(9:16) 의 별도 이미지를
-- 요구하므로 이를 한 슬라이드에 페어로 보관할 컬럼이 필요.
--
-- ───────────────────────────────────────────────────────────────
-- 설계
-- ───────────────────────────────────────────────────────────────
-- - image_url           : PC 용 (필수, 052 의 image_url 그대로 유지)
-- - image_url_mobile    : 모바일 용 (옵션, NULL 이면 PC 이미지 fallback)
--
-- frontend hero (pap-shell-bootstrap.js) 는 window.matchMedia 로
-- viewport 가 모바일 폭이면 image_url_mobile 을 우선 사용. 컬럼이
-- NULL 이면 image_url 으로 자연스럽게 폴백.

BEGIN;

ALTER TABLE cover_images
  ADD COLUMN IF NOT EXISTS image_url_mobile TEXT;

COMMENT ON COLUMN cover_images.image_url_mobile IS
  'QA #296 — optional mobile-portrait image. NULL → fallback to image_url.';

COMMIT;
