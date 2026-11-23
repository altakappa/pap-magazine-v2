-- 191 — 상담봇 (2026-11-23)
--
-- [왜] 도메니코: "홈 우측하단에 고객상담봇을 눌러 들어가서 팝매거진에 대한
-- 질문을 모두 대답해주는 건 어때?"
-- 받은편지함 실측(90일 문의성 메일 295건)에서 묻는 것이 실제로 있었다:
-- 광고 단가·미디어키트, 제출 조건·게재료, 구독 변경, 기고 방법.
--
-- [두 표]
--  · assistant_conversations — 무엇을 묻는지 알기 위해. 첫 달에 이 봇이 주는
--    제일 값어치 있는 것은 답변이 아니라 "사람들이 실제로 뭘 묻는지" 목록이다.
--    30일 뒤 자동 삭제한다 — 제보 파일을 7일 뒤 지우는 것과 같은 원칙이다.
--    개인정보는 받지 않는다. 방문자가 본문에 적어 넣을 수는 있으므로 보존기간을
--    짧게 두고 처리방침에 적는다.
--  · assistant_usage — 하루 지출 상한의 근거. 이번 달에만 OpenAI 크레딧이 15일,
--    X 크레딧이 소진된 채 조용히 죽어 있었다. 광고주 앞에서 조용히 죽는 봇은
--    없느니만 못하다. 세어야 막을 수 있고, 막아야 알릴 수 있다.

create table if not exists public.assistant_conversations (
  id           uuid primary key default gen_random_uuid(),
  session_key  text not null,              -- 브라우저가 만든 임의 값. 계정과 잇지 않는다.
  lang         text,
  page         text,                       -- 어느 페이지에서 열었나 (경로만)
  question     text not null,
  answer       text,
  used_content boolean default false,      -- 기사/에디토리얼을 끌어다 썼나
  handoff      boolean default false,      -- 사람에게 넘겼나 (약속 영역)
  created_at   timestamptz not null default now()
);

create index if not exists idx_assistant_conv_created
  on public.assistant_conversations (created_at desc);
create index if not exists idx_assistant_conv_session
  on public.assistant_conversations (session_key, created_at desc);

-- RLS 켜고 정책 없음 = service-role 만 접근. 공개 읽기 경로를 만들지 않는다.
alter table public.assistant_conversations enable row level security;

create table if not exists public.assistant_usage (
  day            date primary key,
  calls          integer not null default 0,
  input_tokens   bigint  not null default 0,
  output_tokens  bigint  not null default 0,
  blocked        integer not null default 0,   -- 상한에 걸려 거절한 횟수
  updated_at     timestamptz not null default now()
);

alter table public.assistant_usage enable row level security;

-- 하루치 사용량을 한 번의 왕복으로 더한다. 읽고-쓰면 동시 요청에서 어긋난다.
create or replace function public.assistant_usage_add(
  p_day date, p_calls int, p_in bigint, p_out bigint, p_blocked int
) returns public.assistant_usage
language plpgsql
security definer
set search_path = public
as $$
declare r public.assistant_usage;
begin
  insert into public.assistant_usage as u (day, calls, input_tokens, output_tokens, blocked)
  values (p_day, p_calls, p_in, p_out, p_blocked)
  on conflict (day) do update
    set calls         = u.calls + excluded.calls,
        input_tokens  = u.input_tokens + excluded.input_tokens,
        output_tokens = u.output_tokens + excluded.output_tokens,
        blocked       = u.blocked + excluded.blocked,
        updated_at    = now()
  returning * into r;
  return r;
end;
$$;

revoke all on function public.assistant_usage_add(date,int,bigint,bigint,int) from public, anon, authenticated;
