-- 102 · 번역 큐에 '발행 나이' 조건을 추가한다 (2026-08-05)
--
-- 왜 — Google Search Console 실측(7/1~8/4). 한국어 원문 기사의 클릭을
-- 발행 나이로 갈라 보니:
--
--     발행 후 30일 이내 : 25쪽 · 236클릭 (81.1%)
--     31~90일          : 20쪽 ·  53클릭 (18.2%)
--     91일~1년         :  1쪽 ·   2클릭 ( 0.7%)
--     1년 초과         :  0쪽 ·   0클릭 ( 0.0%)
--
-- 클릭의 99.3%가 발행 90일 이내에서 나온다. 1년 넘은 기사는 **원문(한국어)
-- 조차 클릭이 0이다.**
--
-- 그런데 남은 번역 백필은 정확히 그 구간이다. 크론이 published_date DESC 로
-- 돌아 최신부터 처리했기 때문에 최근 기사는 이미 끝났고, 남은 8,282건은
-- 전부 오래된 것들이다 (de 기준: 90일 이내 0건, 1년 초과 1,038건(61%),
-- 가장 최근 미번역 발행일 2026-04-12, 가장 오래된 2019-08-22).
-- 즉 원문으로도 안 팔리는 기사를 7개 언어로 번역하는 중이었다.
--
-- "번역하면 그 언어권엔 새 콘텐츠 아닌가" 는 성립하지 않는다 — 2023년
-- 컴백 뉴스를 오늘 검색하는 사람은 어느 언어에도 없다. 언어가 아니라
-- 시간의 문제다. 그래서 **언어가 아니라 나이로 자른다.**
--
-- 예외(에버그린): 리스티클·인터뷰·에세이는 오래돼도 수요가 있다
-- (7-interactive-websites… 11클릭, 사형수의 마지막 식사, 레이 카와쿠보 vs
-- 준야 와타나베). 그래서 **p_since 는 기본 NULL(제한 없음)** 로 두고,
-- 자동 크론만 값을 넘긴다. 관리자 수동 엔드포인트는 나이 제한 없이
-- 아무 기사나 골라 번역할 수 있다.
--
-- 배포 순서: 인자를 추가하려면 시그니처가 바뀌어 DROP 후 재생성해야 한다.
-- 새 인자에 DEFAULT 가 있으므로 **옛 코드(4인자 호출)도 그대로 동작한다** —
-- 마이그레이션을 먼저 적용해도 안전하다. 잠깐 함수가 없는 순간에는 앱이
-- 예전 전량조회 경로로 폴백한다(100번 마이그레이션의 설계).
--
-- (번호 주의: 101 은 celeb-watch 쪽 101_pepperit_source_tagging.sql 이 먼저
--  푸시돼 선점했다. 같은 날 두 갈래가 동시에 작업하면 번호가 겹친다.)
-- 근거 문서: 볼트 45_Business/PAP_SEO_가이드라인_2026-08-05.md (2-3절)

-- ───────────────────────────────────────────────────────────────
-- SECTION 1 — 아티클 큐 (p_since 추가)
-- ───────────────────────────────────────────────────────────────
drop function if exists public.seo_translate_queue_article(text, int, int, int);

create or replace function public.seo_translate_queue_article(
  p_lang     text,
  p_limit    int  default 5,
  p_min_done int  default 100,
  p_min_src  int  default 80,
  p_since    date default null      -- NULL = 나이 제한 없음 (관리자 수동)
)
returns table (
  id       uuid,
  title    text,
  title_en text,
  src      text,
  extra    text,
  src_len  int
)
language sql stable as $$
  select a.id,
         a.title::text,
         a.title_en,
         coalesce(a.content_en, a.content, ''),
         null::text,
         length(coalesce(a.content_en, a.content, ''))::int
  from public.articles a
  where a.status = 'published'
    and a.title is not null
    and (p_since is null or a.published_date >= p_since)
    and length(btrim(coalesce(a.content_en, a.content, ''))) >= p_min_src
    and not exists (
      select 1 from public.seo_translations t
      where t.kind = 'article' and t.lang = p_lang and t.content_id = a.id
        and length(btrim(coalesce(t.body, ''))) >= p_min_done
    )
  order by a.published_date desc nulls last
  limit greatest(p_limit, 1)
$$;

-- ───────────────────────────────────────────────────────────────
-- SECTION 2 — 카운트 (p_since 추가)
--   잔여를 셀 때도 같은 조건을 써야 한다. 안 그러면 '남8282' 를 계속
--   보고하면서 실제로는 아무것도 처리하지 않는 상태가 된다 — 이 저장소가
--   여러 번 겪은 '가짜 잔여' 패턴이다.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.seo_translate_counts(text, text, int, int);

create or replace function public.seo_translate_counts(
  p_kind     text,
  p_lang     text,
  p_min_done int  default 40,
  p_min_src  int  default 30,
  p_since    date default null
)
returns table (remaining bigint, no_source bigint)
language sql stable as $$
  select
    count(*) filter (where has_src)     as remaining,
    count(*) filter (where not has_src) as no_source
  from (
    select (
             (p_lang = 'it' and length(btrim(coalesce(e.description_it, ''))) > 0)
             or length(btrim(coalesce(e.description_en, e.description, ''))) >= p_min_src
           ) as has_src
    from public.editorials e
    where p_kind = 'editorial'
      and e.status = 'published' and e.title is not null
      and (p_since is null or e.published_date >= p_since)
      and not exists (
        select 1 from public.seo_translations t
        where t.kind = 'editorial' and t.lang = p_lang and t.content_id = e.id
          and length(btrim(coalesce(t.description, ''))) >= p_min_done
      )
    union all
    select length(btrim(coalesce(a.content_en, a.content, ''))) >= p_min_src
    from public.articles a
    where p_kind = 'article'
      and a.status = 'published' and a.title is not null
      and (p_since is null or a.published_date >= p_since)
      and not exists (
        select 1 from public.seo_translations t
        where t.kind = 'article' and t.lang = p_lang and t.content_id = a.id
          and length(btrim(coalesce(t.body, ''))) >= p_min_done
      )
  ) q
$$;

-- ───────────────────────────────────────────────────────────────
-- SECTION 3 — 권한 (DROP 하면 GRANT 도 사라진다 — 반드시 다시 준다)
-- ───────────────────────────────────────────────────────────────
revoke all on function public.seo_translate_queue_article(text, int, int, int, date) from public, anon, authenticated;
revoke all on function public.seo_translate_counts(text, text, int, int, date)        from public, anon, authenticated;
grant execute on function public.seo_translate_queue_article(text, int, int, int, date) to service_role;
grant execute on function public.seo_translate_counts(text, text, int, int, date)       to service_role;

-- ───────────────────────────────────────────────────────────────
-- SECTION 4 — 검증 (적용 후)
-- ───────────────────────────────────────────────────────────────
-- 1) 90일 컷이 실제로 잔여를 0 으로 만드는가
-- select * from seo_translate_counts('article','de',100,80,(current_date - 90));
-- 2) 제한 없이 부르면 예전 값(수천)이 그대로 나오는가 — 관리자 경로 보존
-- select * from seo_translate_counts('article','de',100,80);
-- 3) 권한이 service_role 만인가
-- select p.proname, r.rolname from pg_proc p
--   join pg_namespace n on n.oid=p.pronamespace
--   cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee
--  where n.nspname='public' and p.proname like 'seo_translate%';
