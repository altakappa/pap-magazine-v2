-- ⛔ 이 파일은 실행하지 마라 — 적용 3분 만에 크론을 죽였다 (statement timeout 8초).
-- 의도는 옳았고 결과 집합도 같지만, order by 에 상관 서브쿼리를 넣어 O(n^2) 이 됐다.
-- 같은 우선순위를 246ms 에 내는 정정본: 120_external_images_wix_first_fix_timeout.sql
-- 아래 본문은 '왜 이 순서여야 하는가' 의 근거로만 남긴다.

-- 119 — 이관 순서를 '위험한 것 먼저' 로 (wix 우선) (2026-08-11)
--
-- ■ 왜
-- 지금 큐는 `published_date desc` 하나로만 정렬한다. 즉 최신 글부터 내려간다.
-- 그런데 **가장 위험한 이미지가 가장 오래된 글에 있다.**
--
--   호스트          | 잔량        | 우리 통제권
--   ----------------|-------------|------------------------------------------
--   Google Drive    | 1,064편     | 우리 계정. 우리가 안 지우면 안 사라진다
--   구 S3           |    72편     | 우리 AWS 버킷. 마찬가지
--   static.wixstatic|    71편     | **옛 사이트. 구독이 끊기면 그날로 증발**
--
-- wix 71편은 2019~2022 초창기 아카이브라 날짜순으로는 **맨 끝**이다.
-- 즉 통제권이 없는 것을 제일 늦게 구하는 순서였다. 거꾸로 돌린다.
--
-- ■ 실측 근거 (2026-08-11, 브라우저 직접 확인)
--   · 무작위 wix 5건 → 200, 3333×2223 원본까지 정상 서빙. **호스트는 살아 있다.**
--   · image_migration_failures 에 등재된 wix 3건 → 브라우저에서도 "Forbidden".
--     그 3건은 진짜 죽었고, 기록이 맞다(그래서 이 함수가 계속 건너뛴다).
--   → 나머지 wix 는 지금 당기면 건질 수 있다. 미룰 이유가 없다.
--   (참고: Claude 샌드박스에서 wix 가 403 으로 보이는 건 샌드박스 egress
--    허용목록 문제이지 wix 문제가 아니다. 그걸로 판단하지 말 것.)
--
-- ■ 무엇을 바꾸나 — 정렬만. 대상 집합은 한 건도 안 바뀐다.
--   ① `live` CTE 신설: '아직 안 죽은 URL' 을 한 번만 계산해
--      대상 판정(where)과 우선순위(order by)가 **같은 기준**을 쓰게 한다.
--      (예전엔 where 안에서만 실패를 걸러서, "살아있는 건 드라이브뿐인데
--       죽은 wix URL 때문에 wix 취급" 같은 어긋남이 생길 수 있었다)
--   ② order by 맨 앞에 wix 티어(0) 추가. 그 안에서는 기존대로 날짜 역순.
--
-- ■ 앱(JS)은 안 고친다 — 이번엔 갈래가 하나다
--   api/cron/migrate-external-images.js 는 이 함수가 준 순서를 **그대로** 소비한다
--   (자체 정렬 없음). 107·118 에서 당한 '두 곳에 같은 규칙' 문제가 여기엔 없다.
--   단, EXTERNAL_RE 의 호스트 목록은 여전히 두 곳이다 — 호스트를 늘릴 땐 함께.
--
-- ■ 적용 후 기대값
--   큐 앞머리가 2023-03-02 「LEVELS OF FEMININITY」(drive) 에서
--   wix 최신편(2022-09-21 「apocalyptical-love」 계열)로 바뀐다.
--   30분 주기 · 회당 5~7편 → wix 71편은 약 6시간이면 끝난다.
--   wix 가 마르면 자동으로 티어 1(드라이브·S3)로 돌아간다. 수동 조작 불필요.
--
-- ■ 되돌리기
--   118_external_images_add_wix.sql 의 정의를 다시 실행하면 날짜순으로 복귀.

CREATE OR REPLACE FUNCTION public.external_image_editorials(lim integer DEFAULT 12)
 RETURNS TABLE(id uuid, slug text, cover_image text, thumbnail text, gallery text[])
 LANGUAGE sql
 STABLE
AS $function$
  with cand as (
    select e.id, e.slug, e.cover_image, e.thumbnail, e.gallery, e.published_date
    from editorials e
    where e.status = 'published'
      and (
        e.cover_image ~ 'drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com'
        or e.thumbnail ~ 'drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com'
        or exists (select 1 from unnest(coalesce(e.gallery, '{}')) g
                   where g ~ 'drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com')
      )
  ), urls as (
    select c.id, u.url
    from cand c
    cross join lateral unnest(array[c.cover_image, c.thumbnail] || coalesce(c.gallery, '{}')) as u(url)
    where u.url ~ 'drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com'
  ), live as (
    -- 아직 죽지 않은(=이관을 시도할 값어치가 있는) URL 만. 대상 판정과
    -- 우선순위가 반드시 같은 집합을 봐야 한다.
    select u.id, u.url
    from urls u
    where not exists (select 1 from image_migration_failures f where f.url = u.url)
  )
  select c.id, c.slug, c.cover_image, c.thumbnail, c.gallery
  from cand c
  where exists (select 1 from live l where l.id = c.id)
  order by
    -- ① 남의 집(옛 wix) 먼저 — 구독이 끊기면 복구 불가라 시간이 곧 위험이다.
    (case when exists (
       select 1 from live l where l.id = c.id and l.url ~ 'static\.wixstatic\.com'
     ) then 0 else 1 end),
    -- ② 같은 티어 안에서는 기존 규칙 그대로 (최신 글 먼저).
    c.published_date desc nulls last,
    c.id
  limit lim;
$function$;
