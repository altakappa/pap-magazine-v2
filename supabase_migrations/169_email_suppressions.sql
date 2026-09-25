-- 169: 메일 발송 금지 목록 (2026-09-25, Amazon SES 반송·스팸 신고)
-- api/ses/notifications.js 가 채우고, api/_lib/email.js sendEmail + 주간 발송기가 읽는다.
-- reason: bounce(영구 반송, 모든 메일 금지) / complaint(스팸 신고, 인증·결제 메일만 허용) / soft_bounce(일시 반송, 3회부터 금지)
-- email 은 소문자로만 저장한다(코드에서 정규화). 서버(service role)만 읽고 쓴다: RLS 켜고 정책 없음.

create table if not exists public.email_suppressions (
  email            text primary key check (email = lower(email)),
  reason           text not null check (reason in ('bounce', 'complaint', 'soft_bounce')),
  event_count      integer not null default 1,
  bounce_type      text,
  bounce_sub_type  text,
  diagnostic       text,
  feedback_id      text,
  source           text not null default 'ses',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;

comment on table public.email_suppressions is
  'SES 반송·스팸 신고 주소. bounce=전부 금지, complaint=홍보 금지(인증·결제 허용), soft_bounce=3회부터 금지. 2026-09-25';
