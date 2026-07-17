-- 086 — 광고/제휴 문의 리드 캡처 (business 페이지 폼 수신)
-- 근거: 2026-07-18 광고문의 저조 진단 — mailto 마찰·리드 미캡처 해소.
-- API(api/brand-inquiry.js)가 service_role 로 insert, contact@ 로 알림메일.
create table if not exists public.brand_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  brand_name text,
  contact_name text,
  email text not null,
  phone text,
  inquiry_type text,
  budget_range text,
  timing text,
  message text,
  locale text,
  source text default 'business_page',
  status text not null default 'new'
);
alter table public.brand_inquiries enable row level security;
-- 정책 0개 = anon 전면 차단. 삽입·조회는 service_role(API·admin)만.
create index if not exists brand_inquiries_created_idx on public.brand_inquiries (created_at desc);
