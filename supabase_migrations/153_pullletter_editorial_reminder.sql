-- 153 — 풀레터 후속 제출 독촉 기록 (2026-09-13, 도메니코: "발급 후 4주가 지나도 제출이 없으면 알림")
-- 크론 api/cron/pullletter-editorial-reminder 가 회원 메일 + 텔레그램을 보낸 뒤 여기에 시각을 찍는다.
-- 값이 있으면 다시 보내지 않는다(한 풀레터에 한 번). 되돌리기: drop column.
alter table public.pullletters
  add column if not exists editorial_reminder_sent_at timestamptz;
comment on column public.pullletters.editorial_reminder_sent_at is '발급 4주 뒤 미제출 독촉을 보낸 시각 (2026-09-13). null 이면 아직 안 보냄.';
