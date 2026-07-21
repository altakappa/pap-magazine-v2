-- 089 — celeb_watch_seen 에 헤드라인 지문 배열 추가 (2026-07-21)
--
-- 왜: 도메니코 "여전히 중복된 기사가 여러 번 온다".
-- 실측 결과 같은 기사가 5분 간격으로 6번 알림에 실렸다. 클러스터의 core(사건
-- 구성 요소)는 어떤 헤드라인들이 함께 묶이느냐에 따라 실행마다 흔들리는데,
-- 헤드라인 자체는 변하지 않는다. 그래서 "이미 보낸 헤드라인"을 직접 기억한다.
--
-- titles = 그 알림에 실제로 실린 헤드라인들의 정규화 지문(celebDedup.titleKey).
-- 다음 실행은 이 집합에 있는 헤드라인을 클러스터에서 제외하고, 남는 게 없으면
-- 알림을 보내지 않는다.

alter table public.celeb_watch_seen
  add column if not exists titles text[] default '{}'::text[];

comment on column public.celeb_watch_seen.titles is
  '이 알림에 실린 헤드라인 지문 목록 (celebDedup.titleKey). 헤드라인 단위 중복 차단용.';

-- 최근 48시간만 조회하므로 created_at 인덱스가 이 경로의 핵심이다.
create index if not exists celeb_watch_seen_created_at_idx
  on public.celeb_watch_seen (created_at desc);
