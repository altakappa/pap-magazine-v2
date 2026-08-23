-- 134_ig_follower_flux.sql — 이탈(언팔)을 재는 표 (2026-08-22)
--
-- 왜 ─────────────────────────────────────────────────────────────────
-- 도메니코: "팔로워 이탈자들이 매일 100-200명 있는데 이탈하지 않게 하는
-- 방법이 있을까?"
--
-- 지금 우리가 가진 건 순증(net)뿐이다. 스냅샷(1시간 간격)의 마이너스 구간
-- 합으로 이탈 하한을 내 봤더니 하루 -1~-47 — 도메니코가 인사이트 앱에서
-- 보는 100~200 과 한참 다르다. 같은 시간 안에서 유입과 이탈이 상쇄되면
-- 스냅샷은 못 본다. **즉 우리는 이탈을 못 재고 있다.**
--
-- 인스타 Graph API 의 계정 인사이트 follower_count(period=day)는 "그날의
-- 신규 팔로워 수"(gains)를 준다. 그러면:
--     이탈(unfollows) = gains(API) − net(스냅샷 일별 증감)
-- 이 표는 gains 원본만 저장한다. 이탈은 읽는 쪽(igLedger)에서 도출한다 —
-- net 의 출처(스냅샷)가 하나여야 두 숫자가 어긋나지 않는다.
--
-- 안전: 새 표 하나. 기존 표·RLS 건드리지 않음.
-- 되돌리기: DROP TABLE public.ig_follower_flux;

create table if not exists public.ig_follower_flux (
  day     date not null,
  handle  text not null default 'pap_magazine',
  gains   integer not null,           -- API follower_count: 그날 신규 팔로워
  captured_at timestamptz not null default now(),
  primary key (day, handle)
);

alter table public.ig_follower_flux enable row level security;
-- 서버(service_role)만 쓴다. 클라이언트 정책 없음 = 기본 차단.

comment on table public.ig_follower_flux is
  'IG follower_count(period=day) 원본. 이탈 = gains - net(ig_account_snapshot 일별 증감). igLedger 가 도출.';
