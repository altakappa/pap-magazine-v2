-- 104 · 감시 함수에 에디토리얼을 되돌린다 (2026-08-05, 같은 날 두 번째 정정)
--
-- 왜 — 오전에 에디토리얼 번역을 껐다가 같은 날 되돌렸다.
--
--   껐던 이유: 번역본 클릭이 0이다(GSC 실측, /es/ 79쪽 중 에디토리얼 0쪽).
--   되돌린 이유: 그 판단은 **검색만** 본 것이었다. 사이트 안 언어 전환과 SSR 이
--   seo_translations 를 읽어서(api/seo/editorial/[slug].js 는 번역이 없으면
--   비-ko/en 방문자를 /en 으로 302 리다이렉트한다), 번역을 끊으면 이탈리아어·
--   스페인어 구독자가 신규 화보를 자국어로 볼 수 없게 된다.
--   PAP 는 9개 언어 커뮤니티 플랫폼을 지향하므로 구독자 경험을 깎아 검색
--   점수를 얻는 건 방향이 반대다. → **번역은 만들되 색인은 안 한다**
--   (색인 차단은 _lib/seoRenderer.js 의 noindexTranslatedEditorial 이 담당).
--
-- 그래서 감시 함수도 되돌린다. 103 에서 '아티클만' 으로 좁혔는데, 에디토리얼
-- 번역이 다시 돌기 시작하면 그쪽이 막혀도 감시가 못 본다.
--
-- ⚠️ 이 함수의 상수는 앱 기본값과 같아야 한다(tests/seo-thin-page-policy.test.js 가 강제):
--      90    = SEO_TRANSLATE_MAX_AGE_DAYS
--      6000  = SEO_TRANSLATE_MAX_SRC_CHARS  (아티클에만 적용 — 에디토리얼은
--              저장 전 EDITORIAL_SRC_MAX 로 1,200자에 잘려 상한이 무의미)
--      30    = 에디토리얼 원본 최소 길이 (MIN_SOURCE.editorial)
--      80    = 아티클 원본 최소 길이     (MIN_SOURCE.article)
--
-- 시그니처는 그대로 — pipeline-watch.js 호출부는 손대지 않는다.

create or replace function public.translate_health_stats(window_hours int default 3)
returns table (remaining bigint, produced bigint, done bigint, total_targets bigint)
language sql stable as $$
with langs(lang) as (
  values ('it'),('fr'),('es'),('ja'),('de'),('ru'),('zh')
),
targets as (
  select 'article'::text as kind, a.id
  from public.articles a
  where a.status = 'published' and a.title is not null
    and a.published_date >= current_date - 90
    and length(btrim(coalesce(a.content_en, a.content, ''))) >= 80
    and length(coalesce(a.content_en, a.content, '')) <= 6000
  union all
  select 'editorial'::text, e.id
  from public.editorials e
  where e.status = 'published' and e.title is not null
    and e.published_date >= current_date - 90
    and length(btrim(coalesce(e.description_en, e.description, ''))) >= 30
),
filled as (
  select t.kind, t.lang, t.content_id
  from public.seo_translations t
  where (t.kind = 'article'   and length(btrim(coalesce(t.body,'')))        >= 100)
     or (t.kind = 'editorial' and length(btrim(coalesce(t.description,''))) >= 40)
),
pairs as (
  select tg.kind, l.lang, tg.id as content_id from targets tg cross join langs l
)
select
  (select count(*) from pairs p
     where not exists (select 1 from filled f
                       where f.kind = p.kind and f.lang = p.lang and f.content_id = p.content_id)) as remaining,
  (select count(*) from public.seo_translations t
     where t.updated_at > now() - (window_hours || ' hours')::interval
       and ((t.kind = 'article'   and length(btrim(coalesce(t.body,'')))        >= 100)
         or (t.kind = 'editorial' and length(btrim(coalesce(t.description,''))) >= 40))) as produced,
  (select count(*) from pairs p
     where exists (select 1 from filled f
                   where f.kind = p.kind and f.lang = p.lang and f.content_id = p.content_id)) as done,
  (select count(*) from pairs) as total_targets
$$;

-- 검증
-- select * from translate_health_stats(3);   → remaining 이 수백 이하여야 정상
