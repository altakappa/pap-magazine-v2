-- 164. 감시 대상에 유튜브 공식 채널을 더한다 (2026-09-18)
--
-- [왜] 도메니코: "케이팝 아이돌 정보를 빠르게 알 수 있는 곳은 어디가 있을까?"
-- 컴백은 대부분 **티저 영상이 먼저** 뜬다. 인스타 게시물보다 빠르거나 동시다.
--
-- 유튜브를 고른 이유는 빠르기만이 아니라 **이미 다 깔려 있어서**다:
--   · YOUTUBE_API_KEY 가 환경변수에 이미 있다 (youtube-sync 가 쓴다)
--   · playlistItems.list 는 1 유닛, 무료 할당량은 하루 10,000.
--     채널 14개를 20분마다 봐도 1,008 유닛이다.
--   · 새 크론이 필요 없다 — celeb-account-watch 에 얹는다.
--     (크론 예산이 하루 2,605/2,600 으로 이미 한도를 넘겨 새로 못 만든다.)
--
-- [설계 원칙] 플랫폼이 갈라지는 곳은 **discovery 호출 한 군데뿐**이다.
-- 신선도 24시간 · 중복 방어 · 뉴스 판정 · 알림 문구는 전부 공통이다.
-- ytDiscovery 가 igDiscovery 와 같은 모양을 돌려주도록 맞췄기 때문이다.
-- 플랫폼마다 루프를 복사했다면 규칙이 두 벌이 되고 한쪽만 고쳐졌을 것이다.
--
-- [왜 채널 ID 를 사람이 안 넣나] UC 로 시작하는 24자 문자열은 사람이 보고
-- 맞는지 알 수 없다. 오타가 나도 '결과 없음' 이라 조용히 지나간다.
-- 그래서 사람은 읽을 수 있는 핸들(@BTS)만 넣고, 크론이 처음 한 번
-- channels.list 로 풀어서 ext_id 와 api_name(채널명)을 DB 에 적는다.
-- 인스타 쪽 api_name 과 같은 원리 — '읽혔다' 가 아니라 '누구인지' 를 남긴다.
-- 핸들이 틀리면 items 가 빈 배열로 오고, ytDiscovery 가 그걸 던져
-- last_error 에 '채널을 찾지 못했다' 로 남는다. 조용히 안 지나간다.

alter table public.celeb_watch_accounts
  add column if not exists platform text not null default 'instagram',
  add column if not exists ext_id   text;

alter table public.celeb_watch_accounts
  drop constraint if exists celeb_watch_accounts_platform_chk;
alter table public.celeb_watch_accounts
  add constraint celeb_watch_accounts_platform_chk check (platform in ('instagram','youtube'));

comment on column public.celeb_watch_accounts.platform is
  '164 (2026-09-18) instagram | youtube. 감시 크론이 갈라지는 유일한 지점. 나머지(신선도·중복·뉴스판정·알림)는 전부 공통이다.';
comment on column public.celeb_watch_accounts.ext_id is
  '164 (2026-09-18) 유튜브 채널 ID(UC…). 사람은 핸들(@BTS)만 넣고, 크론이 처음 한 번 API 로 풀어 여기 캐시한다. 캐시가 있으면 channels.list 를 건너뛰어 유닛을 아낀다.';

-- 되돌리려면:
--   delete from public.celeb_watch_accounts where platform = 'youtube';
--   alter table public.celeb_watch_accounts drop constraint if exists celeb_watch_accounts_platform_chk;
--   alter table public.celeb_watch_accounts drop column if exists platform, drop column if exists ext_id;
