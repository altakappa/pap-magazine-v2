-- 138: 프리미엄 회원 크레딧 수정 (2026-08-26 도메니코 지시)
-- 적용 완료: 2026-08-27 Supabase MCP apply_migration 으로 프로덕션 반영됨.
--
-- credits_history: 변경 이력 {at, by, before, after, flags}. 롤백·분쟁 대응용.
-- credits_edit_count: 회원 수정 누적 횟수(상한 3). history 길이로 세면
--   어드민 수정까지 섞여 회원 횟수가 잘못 계산되므로 별도 컬럼으로 둔다.
ALTER TABLE editorials
  ADD COLUMN IF NOT EXISTS credits_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS credits_edit_count smallint NOT NULL DEFAULT 0;
