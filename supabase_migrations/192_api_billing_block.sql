-- 결제(크레딧·지출한도)로 막힌 외부 API 의 재시도 간격을 기억한다 (2026-11-24)
--
-- 왜: OpenAI 는 11/02 부터 22일, X 는 11/12 부터 12일 동안 '돈이 없다' 로
-- 거절했는데, 크론은 30분·60분마다 같은 호출을 그대로 반복했다(임베딩 약
-- 1,050회 · X 지표 약 290회). 거절당하는 호출이라 과금은 안 되지만, 결제가
-- 막힌 것을 알면서 같은 간격으로 계속 묻는 건 설계가 빠진 것이다.
-- 도메니코: "헛돌지않게 해주고".
--
-- 한 줄 = 막힌 자원 하나. 연속 거절마다 next_attempt_at 을 뒤로 밀고,
-- 한 번 성공하면 줄을 지운다. 크론 실행 주기 자체는 건드리지 않는다 —
-- 크론은 계속 깨어나지만 창이 열릴 때까지 외부 호출을 하지 않는다.
create table if not exists public.api_billing_block (
  key               text primary key,
  blocked_since     timestamptz not null default now(),
  consecutive       integer     not null default 1,
  last_status       integer,
  last_kind         text,
  next_attempt_at   timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 서비스 롤만 쓴다. 공개 정책은 두지 않는다(운영 상태는 공개 대상이 아니다).
alter table public.api_billing_block enable row level security;

comment on table public.api_billing_block is
  '결제로 막힌 외부 API 의 지수 백오프 상태. 성공하면 줄을 지운다. (2026-11-24)';
comment on column public.api_billing_block.consecutive is
  '연속 거절 횟수. 3회부터 해당 크론을 실패(5xx)로 찍어 대시보드에 드러낸다.';
