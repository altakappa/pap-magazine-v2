-- ──────────────────────────────────────────────────────────────────────
-- 148 — profiles.instagram 유일 인덱스 (2026-09-12, 도메니코 정책: 인스타그램 공동작업자)
--
-- 왜: 서브미션 제출자가 공동작업자를 인스타그램 아이디로 고르면 서버가 profiles.instagram
--     으로 회원을 찾아 프리미엄 여부를 판정한다(api/_lib/collaborators.js). 한 아이디가
--     두 계정에 걸리면 누가 프리미엄인지 정할 수 없다. PUT /api/auth/me 가 저장 전에
--     중복을 거부하지만, 동시 요청·직접 수정을 막는 마지막 자물쇠는 DB 인덱스다.
--
-- 값은 API 가 정규화(소문자·@ 제거·URL 벗김)해서 넣는다. 실측 2026-09-12: 1,235행 전부 NULL/''
--     이라 기존 데이터와 충돌하지 않는다. 빈 값은 인덱스에서 뺀다(여러 명이 비어 있어도 됨).
-- 되돌리기: DROP INDEX IF EXISTS public.profiles_instagram_unique;
-- ──────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS profiles_instagram_unique
  ON public.profiles (lower(instagram))
  WHERE instagram IS NOT NULL AND instagram <> '';
