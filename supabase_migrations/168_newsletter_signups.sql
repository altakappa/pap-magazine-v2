-- 168 (2026-09-25) — 회원가입 없이 이메일만으로 받는 주간 뉴스레터 명단.
--
-- [왜] 도메니코 "회원가입 없이 이메일만으로 받는 가입창 만들기".
--   실측: 회원 1,357 중 이메일 수신동의 172(13%). 인스타 팔로워 38.5만이 뉴스레터로 들어올 입구가 없었다.
--
-- [규칙]
--   · 이중 확인: 가입(pending) → 확인 메일 버튼(confirmed). confirmed 만 발송 대상.
--     (이탈리아 Garante 2025-06-04 결정이 이중 확인을 동의 증명의 최소 기준으로 봄)
--   · consent_text 에 가입 순간 화면에 보인 동의 문구를 그대로 남긴다(서버 사본 newsletterCopy.consent).
--   · 같은 주소가 PAP 회원이면 발송기는 이 표로 보내지 않는다 — 회원은 profiles.email_consent 기준.
--   · token 하나로 확인·수신거부. 수신거부 후 다시 가입하면 토큰을 새로 만든다.
--   · service_role 전용(RLS 켜고 정책 없음).

create table if not exists public.newsletter_signups (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  language         text not null default 'en',
  source           text,
  status           text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  token            uuid not null default gen_random_uuid(),
  consent_text     text not null,
  ip_hash          text,
  created_at       timestamptz not null default now(),
  confirm_sent_at  timestamptz,
  confirmed_at     timestamptz,
  unsubscribed_at  timestamptz,
  updated_at       timestamptz not null default now()
);

create unique index if not exists newsletter_signups_email_key on public.newsletter_signups (lower(email));
create unique index if not exists newsletter_signups_token_key on public.newsletter_signups (token);
create index if not exists newsletter_signups_status_idx on public.newsletter_signups (status);

alter table public.newsletter_signups enable row level security;

comment on table public.newsletter_signups is
  '비회원 주간 뉴스레터 명단 (168, 2026-09-25). 이중 확인: confirmed 만 발송. 회원 주소는 발송기에서 제외(profiles.email_consent 기준). service_role 전용.';
