-- 177: email_campaigns.type 에 'creator-monthly' 허용 (2026-10-03)
-- 사고: 9/24 만든 creator-monthly 크론이 10/1 01:00 첫 실행에서 check 제약 위반으로 500.
--       월간 크리에이터 소식 초안도, 이달의 테마 후보 3개도 안 만들어졌다(cron_runs 실측).
-- 적용 완료: 2026-10-03 Supabase MCP apply_migration.
ALTER TABLE email_campaigns DROP CONSTRAINT email_campaigns_type_check;
ALTER TABLE email_campaigns ADD CONSTRAINT email_campaigns_type_check
  CHECK (type = ANY (ARRAY['editorial-weekly'::text, 'news-weekly'::text, 'one-off'::text, 'creator-pullletter'::text, 'creator-monthly'::text]));
