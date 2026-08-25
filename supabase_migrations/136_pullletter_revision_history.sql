-- 136_pullletter_revision_history.sql  (2026-08-25 적용 완료 — Supabase MCP)
-- 풀레터 피드백 왕복: 도메니코 피드백 ↔ 신청자 무드보드 수정 재제출을
-- 반복하다 적합해지면 발급. 그 왕복 기록.
-- [{at, by:'pap'|'member', note?, files?}] — 최신이 뒤에 붙는다.
alter table pullletters add column if not exists revision_history jsonb not null default '[]'::jsonb;
