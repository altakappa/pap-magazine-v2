-- 137: email_campaigns.type 에 'creator-pullletter' 허용
-- (2026-08-26 유료 구독자 늘리기 1탄-② — 무료 제출자 대상 풀레터 소개 캠페인)
-- 적용 완료: 2026-08-26 Supabase MCP apply_migration 으로 프로덕션 반영됨.
ALTER TABLE email_campaigns DROP CONSTRAINT email_campaigns_type_check;
ALTER TABLE email_campaigns ADD CONSTRAINT email_campaigns_type_check
  CHECK (type = ANY (ARRAY['editorial-weekly'::text, 'news-weekly'::text, 'one-off'::text, 'creator-pullletter'::text]));
