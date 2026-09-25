-- 170: 화보 공개 알림(공유용 링크) 메일을 한 번만 보내기 위한 도장 (2026-09-25, api/_lib/editorialLive.js)
alter table public.editorials add column if not exists live_email_sent_at timestamptz;
comment on column public.editorials.live_email_sent_at is '화보 공개 순간 크리에이터에게 공유용 링크 메일을 보낸 시각. 비어 있을 때만 보낸다.';
