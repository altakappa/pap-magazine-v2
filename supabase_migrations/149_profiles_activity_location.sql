-- ──────────────────────────────────────────────────────────────────────
-- 149 — profiles 주요 활동 국가·도시 (2026-09-12, 도메니코: 인스타그램 아이디 외에 주요 활동 국가 및 도시도)
--
-- 공동작업자 지정용 프로필 정보. 마이페이지 계정 정보에서 인스타그램 아이디와 함께 적는다.
-- 인스타그램 아이디를 등록하려면 둘 다 필수(PUT /api/auth/me 가 400 ACTIVITY_LOCATION_REQUIRED).
-- 기존 `country` 칼럼은 요청 지역 자동 추정(이메일 로케일)용이라 건드리지 않는다 — 뜻이 다르다.
-- 되돌리기: ALTER TABLE public.profiles DROP COLUMN activity_country, DROP COLUMN activity_city;
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS activity_country TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS activity_city    TEXT;
