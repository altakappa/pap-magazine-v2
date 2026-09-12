-- 150: 감시 계정을 "왜" 껐는지 적는 칸 (2026-09-12)
--
-- 배경. celeb-account-watch 가 18회 연속 "생산 0 · 잔여 12" 로 경보를 울렸다.
-- 파본 건 없었다. 12개 계정이 2026-09-01 20:12 KST 에 전부 enabled=false 가
-- 된 것뿐이다. last_error 는 전부 null, baseline_done 은 전부 true 였다.
-- 저장소 전체에 enabled=false 를 쓰는 코드가 없다 → 사람이 DB 에서 직접 껐다.
--
-- 왜 껐는지는 숫자가 설명한다 (2026-09-11 실측):
--   자동감시가 만든 브리프 126건 (done 96 · failed 30) → **발행 0건**
--   수동(텔레그램) 13건 → 발행 1건
--   8/24~9/1 9일간 하루 평균 14건을 텔레그램으로 쐈고 아무것도 안 올라갔다.
-- 끈 것은 옳은 판단이었다. 되살리면 스팸이 그대로 돌아온다.
--
-- 문제는 그 판단이 **어디에도 안 적혀 있다**는 것이었다. 그래서 크론은
-- "누가 몰래 꺼놨다" 로 읽고 경보를 울렸다. 경보가 틀린 게 아니라
-- 시스템이 사람의 결정을 모르고 있었다.
--
-- 이 칸이 그 결정을 담는다.
--   disabled_reason 이 있는 비활성  = 의도된 상태 → 조용히 둔다
--   disabled_reason 이 없는 비활성  = 설명 없는 상태 → 계속 경보
-- 앞으로 계정을 끌 때는 사유를 같이 적어야 조용해진다. 그게 이 칸의 목적이다.

alter table celeb_watch_accounts
  add column if not exists disabled_reason text;

comment on column celeb_watch_accounts.disabled_reason is
  '비활성으로 둔 이유. 값이 있으면 의도된 비활성이라 크론이 경보를 울리지 않는다. 값 없이 enabled=false 면 설명 없는 상태로 보고 경보한다.';

-- 9/1 에 꺼진 12개에 사유를 소급 기입한다.
-- (enabled=false 이고 아직 사유가 없는 행만. 나중에 켠 계정은 건드리지 않는다.)
update celeb_watch_accounts
   set disabled_reason =
       '2026-09-01 비활성. 자동감시 브리프 126건 중 발행 0건(하루 평균 14건 텔레그램 알림). 되살리려면 계정 선택·게이트부터 다시 세울 것.'
 where enabled = false
   and disabled_reason is null;
