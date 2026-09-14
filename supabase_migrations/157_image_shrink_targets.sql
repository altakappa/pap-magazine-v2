-- 157 — 백필이 "남은 것"을 제대로 찾게 한다 (2026-09-14, 백필 헛돌기 사고)
--
-- [무슨 일이 있었나] 156 으로 만든 백필이 1,615장(5.7GB 절감)을 처리한 뒤
-- **호출 165회 동안 한 장도 처리하지 못하고 헛돌았다.** 오류는 한 건도 없었다.
--
-- [원인] PNG 다. 백필은 경로를 그대로 두려고 형식을 유지했는데(keepFormat),
-- 사진을 PNG 로 다시 누르면 별로 안 준다. 실측:
--   2,003,054 바이트 → 1,611,523 바이트 (20% 만 감소)
-- 그래서 처리한 뒤에도 **여전히 1MB 를 넘어 후보 목록에 남는다.**
-- 코드는 "크기 큰 순 상위 96장" 을 가져온 뒤 진행 표에 있는 것을 걸러내는 방식이라,
-- 목록 위쪽이 '처리했지만 여전히 큰 PNG' 로 가득 차면 걸러낸 뒤 빈 배열이 된다.
-- media 버킷의 PNG 는 8,212개 6.7GB 다. 위쪽을 점령하기 충분했다.
--
-- [고치는 방법] "남은 것" 을 코드가 아니라 **DB 가 판별하게** 한다.
-- 진행 표에 있는 이름을 애초에 목록에서 빼버리면, 위쪽이 무엇으로 채워지든
-- 상관없이 항상 진짜 남은 것이 나온다.
--
-- 곁들여 얻는 것: scan 의 '남은 후보' 가 진짜 남은 수가 된다.
-- 종전에는 이미 처리한 것까지 세어 4,499 로 보였다.

create or replace view public.image_shrink_targets as
select
  m.name        as name,
  m.size_bytes  as size_bytes,
  m.mimetype    as mimetype
from public.media_objects m
left join public.image_shrink_progress p
       on p.name = m.name
where m.bucket_id = 'media'
  and m.size_bytes > 1000000
  and m.name not like 'originals/%'
  and (m.name ilike '%.jpg' or m.name ilike '%.jpeg' or m.name ilike '%.png')
  and p.name is null;

comment on view public.image_shrink_targets is
  '157 (2026-09-14) — 아직 안 줄인 큰 이미지만. 진행 표에 있는 것은 DB 가 미리 뺀다. 코드가 거르면 목록 위쪽이 막혀 헛돈다.';

revoke all on public.image_shrink_targets from anon, authenticated;
grant select on public.image_shrink_targets to service_role;
