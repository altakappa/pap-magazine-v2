-- 155 — 프리미엄 크리에이터 공개 프로필 강화 (2026-09-13, 도메니코 "5번 적용")
--   ① 연락 버튼 기록: 로그인 회원이 /contributor/:handle 의 연락 버튼으로 보낸 메시지.
--      api/contributors/contact.js 가 하루 3건 제한을 여기서 세고, 메일은 크리에이터에게 전달(크리에이터 메일 주소는 노출 안 함).
--   ② contributor_counts(handles): 주어진 인스타 아이디들의 발행 화보 수 — 프리미엄은 1편부터 목록에 올리므로
--      top_contributors(p_min=2) 로는 못 잡는 1편 기여자를 이 함수로 채운다. 공개 크레딧(editorials.credits)만 집계.
-- 되돌리기: drop table public.contributor_contacts; drop function public.contributor_counts(text[]);

create table if not exists public.contributor_contacts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null,
  recipient_id uuid not null,
  handle text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists contributor_contacts_sender_created_idx on public.contributor_contacts (sender_id, created_at desc);
create index if not exists contributor_contacts_recipient_created_idx on public.contributor_contacts (recipient_id, created_at desc);
alter table public.contributor_contacts enable row level security;   -- 서버(service_role)만 읽고 쓴다
comment on table public.contributor_contacts is '기여자 프로필 연락 버튼 메시지 기록 (2026-09-13). 발신자 하루 3건 제한의 근거.';

create or replace function public.contributor_counts(p_handles text[])
returns table(handle text, display_name text, roles text[], editorial_count bigint, latest date)
language sql stable as $$
  with agg as (
    select lower(regexp_replace(c->>'instagram','^@','')) as handle,
           max(c->>'name') as display_name,
           (array_agg(distinct r) filter (where r is not null)) as all_roles,
           count(distinct e.id) as editorial_count,
           max(e.published_date) as latest
    from editorials e
         cross join lateral jsonb_array_elements(e.credits) c
         left join lateral jsonb_array_elements_text(c->'roles') r on true
    where e.status = 'published'
      and jsonb_typeof(e.credits) = 'array'
      and coalesce(c->>'instagram','') ~ '^@?[A-Za-z0-9._]{2,60}$'
      and lower(regexp_replace(c->>'instagram','^@','')) = any (select lower(regexp_replace(h,'^@','')) from unnest(p_handles) h)
    group by 1
  )
  select handle, display_name, all_roles[1:6] as roles, editorial_count, latest
  from agg
  order by editorial_count desc, latest desc
$$;
