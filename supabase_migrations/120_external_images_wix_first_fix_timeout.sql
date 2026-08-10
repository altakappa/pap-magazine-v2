-- 120 — 119 가 크론을 죽였다. 같은 우선순위를 8초 안에 끝나게 다시 쓴다 (2026-08-11)
--
-- ■ 무슨 일이 있었나 (내 실수다)
-- 119 적용 3분 뒤 23:40 UTC 실행이 통째로 실패했다:
--     ok=false · 8,565ms · error='selector failed: canceling statement due to statement timeout'
-- PostgREST 경유 statement_timeout(8초)에 걸린 것이다. 이관은 0편.
--
-- ■ 원인 — 상관 서브쿼리를 order by 에 넣었다
-- 119 는 `live` CTE(비물질화)를 order by 안에서 행마다 다시 평가했다:
--     order by (case when exists (select 1 from live l where l.id = c.id and ...) ...)
-- 기존 정의에도 where 절에 상관 exists 가 하나 있었는데, 거기에 하나를 더 얹은 셈이다.
-- CTE 가 인라인되므로 후보 1,221편마다 urls(18,625행)를 다시 훑는다 → O(n^2).
-- **정렬 기준 하나 추가가 쿼리 비용을 곱셈으로 키웠다.**
--
-- ■ 고친 방법 — 상관 서브쿼리를 없애고 한 번만 집계한다
--   ① CTE 를 전부 `as materialized` — 재평가 금지 (Postgres 12+ 기본은 인라인)
--   ② `agg` CTE: id 별로 bool_or(url ~ wix) 를 **한 번** 계산 (HashAggregate)
--   ③ 대상 판정도 join 으로 — where exists 마저 사라진다
-- 결과 집합·순서는 119 의 의도와 100% 같다. 계산 방식만 바뀐다.
--
-- ■ 실측 (explain analyze, 적용 직전)
--     119  : 8,000ms+ 에서 강제 종료 (timeout)
--     120  : **246ms** — 예산의 1/32
--     잔량 1,207 → 1,207 (집합 불변) · 큐 앞 12편 전부 WIX (Connection 2023-01-03 …)
--
-- ■ 교훈 (다음 사람에게)
--   · order by 에 상관 서브쿼리를 넣지 마라. 정렬은 **모든 행**에 대해 평가된다.
--     where 는 걸러내면 끝이지만 order by 는 전수다.
--   · CTE 는 기본이 인라인이다. 두 번 이상 참조하면 두 번 이상 계산된다.
--     `as materialized` 를 붙이거나, 애초에 집계해서 한 번만 만들어라.
--   · 이 함수는 크론이 30분마다 두 번(선별 + 잔량 카운트) 호출한다.
--     느려지면 조용히 느려지는 게 아니라 **크론이 통째로 죽는다.**
--     정의를 바꾸면 반드시 `explain analyze` 로 재라 — 8초가 상한이다.
--
-- ■ 되돌리기
--   118_external_images_add_wix.sql 을 다시 실행하면 wix 우선순위 없이 날짜순 복귀.
--   (119 는 실행하지 말 것 — 위 사고를 재현한다)

CREATE OR REPLACE FUNCTION public.external_image_editorials(lim integer DEFAULT 12)
 RETURNS TABLE(id uuid, slug text, cover_image text, thumbnail text, gallery text[])
 LANGUAGE sql
 STABLE
AS $function$
  with cand as materialized (
    select e.id, e.slug, e.cover_image, e.thumbnail, e.gallery, e.published_date
    from editorials e
    where e.status = 'published'
      and (
        e.cover_image ~ 'drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com'
        or e.thumbnail ~ 'drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com'
        or exists (select 1 from unnest(coalesce(e.gallery, '{}')) g
                   where g ~ 'drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com')
      )
  ), urls as materialized (
    select c.id, u.url
    from cand c
    cross join lateral unnest(array[c.cover_image, c.thumbnail] || coalesce(c.gallery, '{}')) as u(url)
    where u.url ~ 'drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com'
  ), agg as materialized (
    -- 죽은 URL 을 뺀 뒤, id 별로 'wix 를 하나라도 갖고 있나' 를 한 번만 계산한다.
    -- 여기서 나온 id 집합이 곧 이관 대상이다(= 살아있는 외부 URL 이 하나라도 있음).
    select u.id, bool_or(u.url ~ 'static\.wixstatic\.com') as has_wix
    from urls u
    where not exists (select 1 from image_migration_failures f where f.url = u.url)
    group by u.id
  )
  select c.id, c.slug, c.cover_image, c.thumbnail, c.gallery
  from cand c
  join agg a on a.id = c.id
  order by
    -- ① 남의 집(옛 wix) 먼저 — 구독이 끊기면 복구 불가라 시간이 곧 위험이다.
    (case when a.has_wix then 0 else 1 end),
    -- ② 같은 티어 안에서는 기존 규칙 그대로 (최신 글 먼저).
    c.published_date desc nulls last,
    c.id
  limit lim;
$function$;
