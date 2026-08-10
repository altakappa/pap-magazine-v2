-- 118 — 이관 대상에 wixstatic 추가 + 헛 실패 기록 정리 (2026-08-09)
--
-- ■ 왜
-- 「깨진 대표 이미지 19건」 경보를 파보니 세 갈래였다:
--   · wixstatic 403  — 구 사이트 이미지의 핫링크 차단 (71건이 여기 걸려 있다)
--   · drive 404/500  — 진짜 소실 가능성
--   · supabase timeout — **헛경보** (파일 6건 모두 존재, 0.1~1.1MB)
--
-- wixstatic 71건은 **어느 크론의 대상도 아니었다.** 이관 크론의 대상 목록에
-- 없었기 때문이다. 앱(JS)의 EXTERNAL_RE 와 이 SQL 함수 **두 곳**에 같은 목록이
-- 적혀 있어, 한쪽만 고치면 조용히 어긋난다 (107 에서 똑같이 당했다).
-- 두 곳을 함께 바꾼다.
--
-- ■ 함께 정리하는 것 — 자사 파일 24건의 헛 실패 기록
-- image_migration_failures 에 오른 URL 은 이 함수가 **영구히 건너뛴다.**
-- 그런데 주간 점검 크론이 자기가 만들어낸 거짓 timeout 까지 이 표에 넣어서,
-- 멀쩡한 자사 Supabase 파일 24건이 '실패'로 등재돼 있었다.
-- 지금은 supabase URL 이 이관 대상이 아니라 실질 피해가 없지만, 대상 목록이
-- 넓어지는 순간 멀쩡한 파일이 영구 제외된다. 지금 지운다.
-- (크론 쪽도 함께 고쳤다 — 확정 실패(404·html)만 기록한다)
--
-- ■ 적용 후 기대값
--   대상 잔량: 드라이브 1,077 + 구 S3 180 + wix 71
--
-- ■ 되돌리기
--   image_migration_infra 마이그레이션의 원래 정의를 다시 실행.

-- ① 헛 실패 기록 제거 (자사 파일에 대한 link-check timeout 만)
delete from public.image_migration_failures
where reason like 'link-check: timeout%'
  and url ilike '%supabase.co%';

-- ② 대상 호스트에 wixstatic 추가 (JS 의 EXTERNAL_RE 와 반드시 같아야 한다)
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
  )
  select c.id, c.slug, c.cover_image, c.thumbnail, c.gallery
  from cand c
  where exists (
    select 1
    from urls u
    where u.id = c.id
      and not exists (select 1 from image_migration_failures f where f.url = u.url)
  )
  order by c.published_date desc nulls last, c.id
  limit lim;
$function$;
