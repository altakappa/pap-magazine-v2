-- 163. 감시 계정의 '진짜 신원' 을 기록한다 (2026-09-18)
--
-- [왜] 도메니코: "개인 멤버 계정 너가 스스로 찾아서 추가할 순 없어?"
-- 찾을 수는 있다. 문제는 **찾은 게 맞는지**다.
--
-- 지금 구조에서 잘못된 핸들은 두 갈래로 갈린다.
--   ① 존재하지 않는 핸들 → business_discovery 가 실패 → last_error 에 남는다. 보인다.
--   ② 존재하지만 엉뚱한 계정 → 정상적으로 읽힌다. **아무 데도 안 남는다.**
--      오타가 남의 계정과 겹치거나, 공식이 아니라 팬 계정인 경우가 여기다.
--      멤버 개인 계정은 핸들이 불규칙해서(@j.m, @thv, @i.2.n.8) ②가 훨씬 잘 난다.
--
-- '읽혔다' 로는 부족하다. '누구인지' 를 적어야 사람이 한 번 훑고 거를 수 있다.
-- API 는 이미 name 과 followers_count 를 주는데 코드가 버리고 있었다.
--
-- [쓰는 법] 폴링이 한 바퀴 돈 뒤:
--   select username, label, api_name, followers from celeb_watch_accounts
--    where enabled order by followers nulls first;
--   · api_name 이 label 과 전혀 다르면 → 잘못 넣은 계정
--   · followers 가 유독 적으면 → 팬 계정일 가능성
--   · 둘 다 null 인데 last_error 도 null 이면 → 아직 순번이 안 왔다

alter table public.celeb_watch_accounts
  add column if not exists api_name  text,
  add column if not exists followers bigint;

comment on column public.celeb_watch_accounts.api_name is
  '163 (2026-09-18) 인스타 API 가 말하는 그 계정의 실제 표시 이름. 핸들을 사람이 찍어 넣으면 오타·동명이인이 조용히 통과한다. 이 칸이 label 과 어긋나면 잘못 넣은 계정이다.';
comment on column public.celeb_watch_accounts.followers is
  '163 (2026-09-18) 팔로워 수. 공식 계정인지 팬 계정인지 가르는 가장 빠른 신호.';

-- 되돌리려면:
--   alter table public.celeb_watch_accounts drop column if exists api_name, drop column if exists followers;
