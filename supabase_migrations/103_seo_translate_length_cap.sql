-- 103 · 번역 큐 길이 상한 + 감시 함수 정합 (2026-08-05)
--
-- ── 사건 ────────────────────────────────────────────────────────────
-- 90일 컷 배포 후 zh 잔여 181건이 한 건도 줄지 않았다. 매 실행 AI 호출
-- 2회(약 80초)를 쓰고 저장 0건. 하루로 치면 1,440회 헛호출이다.
--
-- 원인은 큐 맨 앞에 박힌 거대한 기사 두 건이었다:
--     'Acne Studios 30주년 애프터 파티'        9,052자
--     '밀란 패션위크 SS27 스트릿 스타일'      12,963자
--
-- 중국어는 같은 내용도 출력 토큰이 2~3배라 호출 타임아웃(40~60초) 안에
-- 못 끝낸다. 그런데 큐는 published_date DESC 고정이라 **매 실행 똑같은
-- 두 건을 다시 시도**하고, 뒤의 179건은 영원히 차례가 오지 않는다.
--
-- 이 저장소가 이미 겪은 패턴이다 — _lib/seoTranslateBackfill.js 주석:
-- "fr·es 에디토리얼 큐 맨 앞에 설명 7,387자짜리가 한 건 박혀 있다"(poison
-- pill). 그때는 에디토리얼이라 EDITORIAL_SRC_MAX(1,200)로 막았는데,
-- **아티클에는 그 상한이 없었다.**
--
-- ── 임계값 근거 (추정 아님) ─────────────────────────────────────────
-- 지금까지 성공한 zh 아티클 번역 329건의 원문 길이 분포:
--     최대 2,293자 · 중앙값 1,222 · p90 1,497 · p99 1,764
--     6,000자 초과 성공 사례 **0건**
-- 반대로 막고 있던 건 9,052 / 12,963자. 성공 최대치와 실패 사이가 넓게
-- 벌어져 있어 6,000 은 안전한 선이다. zh 잔여 181건 중 6,000 초과는 2건뿐 —
-- **2건을 빼면 179건이 즉시 풀린다.**
--
-- 자르지 않고 '제외'하는 이유: 잘린 본문을 저장하면 사용자에게 문장이
-- 끊긴 페이지가 나간다(같은 파일 upsert 주석). 제외된 건은 관리자 수동
-- 엔드포인트로 처리한다 — 에버그린 예외와 같은 구조다.
--
-- ── 감시 함수도 같이 고친다 ─────────────────────────────────────────
-- translate_health_stats(096)는 90일 컷도 길이 상한도 모른 채 전체를 세어
-- '잔량 8,124건'으로 경보를 올렸다. 실제 대상은 181건이었다. 안 고치면
-- 매일 오경보가 울리고, 오경보가 반복되면 진짜 경보를 무시하게 된다.
--
-- 근거 문서: 볼트 45_Business/PAP_SEO_가이드라인_2026-08-05.md

-- ───────────────────────────────────────────────────────────────
-- SECTION 1 — 아티클 큐: p_max_src 추가 (0 = 상한 없음)
-- ───────────────────────────────────────────────────────────────
drop function if exists public.seo_translate_queue_article(text, int, int, int, date);

create or replace function public.seo_translate_queue_article(
  p_lang     text,
  p_limit    int  default 5,
  p_min_done int  default 100,
  p_min_src  int  default 80,
  p_since    date default null,
  p_max_src  int  default 0      -- 0 = 상한 없음 (관리자 수동 경로)
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
    and (p_max_src <= 0 or length(coalesce(a.content_en, a.content, '')) <= p_max_src)
    and not exists (
      select 1 from public.seo_translations t
      where t.kind = 'article' and t.lang = p_lang and t.content_id = a.id
        and length(btrim(coalesce(t.body, ''))) >= p_min_done
    )
  order by a.published_date desc nulls last
  limit greatest(p_limit, 1)
$$;

-- ───────────────────────────────────────────────────────────────
-- SECTION 2 — 카운트: too_long 을 따로 돌려준다
--   '처리할 수 있는 잔여'와 '너무 길어 뺀 건수'를 뭉뚱그리면, 큐가 막힌
--   상태를 '아직 할 일이 남았다'로 착각한다. 오늘 정확히 그 착각을 했다.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.seo_translate_counts(text, text, int, int, date);

create or replace function public.seo_translate_counts(
  p_kind     text,
  p_lang     text,
  p_min_done int  default 40,
  p_min_src  int  default 30,
  p_since    date default null,
  p_max_src  int  default 0
)
returns table (remaining bigint, no_source bigint, too_long bigint)
language sql stable as $$
  select
    count(*) filter (where has_src and not too_big)     as remaining,
    count(*) filter (where not has_src)                 as no_source,
    count(*) filter (where has_src and too_big)         as too_long
  from (
    select (
             (p_lang = 'it' and length(btrim(coalesce(e.description_it, ''))) > 0)
             or length(btrim(coalesce(e.description_en, e.description, ''))) >= p_min_src
           ) as has_src,
           false as too_big          -- 에디토리얼은 저장 전 1,200자로 잘려 상한이 무의미
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
    select length(btrim(coalesce(a.content_en, a.content, ''))) >= p_min_src,
           (p_max_src > 0 and length(coalesce(a.content_en, a.content, '')) > p_max_src)
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
-- SECTION 3 — 감시 함수를 실제 정책에 맞춘다
--
--   ⚠️ 아래 세 숫자는 앱의 기본값과 **반드시 같아야 한다**:
--        90    = SEO_TRANSLATE_MAX_AGE_DAYS   (cron/backfill-translations.js)
--        6000  = SEO_TRANSLATE_MAX_SRC_CHARS  (cron/backfill-translations.js)
--        article 만 = SEO_TRANSLATE_KINDS 기본값
--   앱에서 값을 바꾸면 여기도 바꾼다. tests/seo-thin-page-policy.test.js 가
--   두 곳의 숫자가 어긋나면 실패하도록 잡아 준다.
--
--   시그니처는 그대로 두어 pipeline-watch.js 호출부는 손대지 않는다.
-- ───────────────────────────────────────────────────────────────
create or replace function public.translate_health_stats(window_hours int default 3)
returns table (remaining bigint, produced bigint, done bigint, total_targets bigint)
language sql stable as $$
with langs(lang) as (
  values ('it'),('fr'),('es'),('ja'),('de'),('ru'),('zh')
),
targets as (
  -- 에디토리얼은 2026-08-05 부터 자동 번역 대상이 아니다(GSC 실측: 클릭 0).
  -- 아티클만, 최근 90일, 6,000자 이하 — 크론이 실제로 하는 일과 같은 정의.
  select a.id
  from public.articles a
  where a.status = 'published' and a.title is not null
    and a.published_date >= current_date - 90
    and length(btrim(coalesce(a.content_en, a.content, ''))) >= 80
    and length(coalesce(a.content_en, a.content, '')) <= 6000
),
filled as (
  select t.lang, t.content_id
  from public.seo_translations t
  where t.kind = 'article' and length(btrim(coalesce(t.body,''))) >= 100
),
pairs as (
  select l.lang, tg.id as content_id from targets tg cross join langs l
)
select
  (select count(*) from pairs p
     where not exists (select 1 from filled f
                       where f.lang = p.lang and f.content_id = p.content_id)) as remaining,
  (select count(*) from public.seo_translations t
     where t.kind = 'article'
       and t.updated_at > now() - (window_hours || ' hours')::interval
       and length(btrim(coalesce(t.body,''))) >= 100) as produced,
  (select count(*) from pairs p
     where exists (select 1 from filled f
                   where f.lang = p.lang and f.content_id = p.content_id)) as done,
  (select count(*) from pairs) as total_targets
$$;

-- ───────────────────────────────────────────────────────────────
-- SECTION 4 — 권한 (DROP 하면 사라진다)
-- ───────────────────────────────────────────────────────────────
revoke all on function public.seo_translate_queue_article(text, int, int, int, date, int) from public, anon, authenticated;
revoke all on function public.seo_translate_counts(text, text, int, int, date, int)        from public, anon, authenticated;
grant execute on function public.seo_translate_queue_article(text, int, int, int, date, int) to service_role;
grant execute on function public.seo_translate_counts(text, text, int, int, date, int)       to service_role;

-- ───────────────────────────────────────────────────────────────
-- SECTION 5 — 검증
-- ───────────────────────────────────────────────────────────────
-- 1) 상한을 걸면 막힌 2건이 빠지고 179건이 남는가
-- select * from seo_translate_counts('article','zh',100,80,(current_date-90),6000);
--    → remaining 179 · too_long 2 를 기대
-- 2) 큐 선두가 더 이상 9,052자가 아닌가
-- select title, src_len from seo_translate_queue_article('zh',3,100,80,(current_date-90),6000);
-- 3) 감시 잔량이 8,124 에서 실제값으로 내려왔는가
-- select * from translate_health_stats(3);
