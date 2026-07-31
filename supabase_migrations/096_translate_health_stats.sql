-- 096 · 번역 백필 건강도 (2026-07-31) — 이미 Supabase 에 적용됨, 저장소 기록용
--
-- 왜: es 는 7/24, ja 는 7/22 이후 한 건도 안 늘었는데 열흘간 아무도 몰랐다.
-- 크론은 성실히 돌았고 전부 ok 로 기록됐다 — 저장만 0건이었다.
-- pipeline-watch 가 이 함수로 '실제 생산량'을 보고 정체를 잡는다.
--
-- 핵심: '행이 존재하는가'가 아니라 '내용이 실제로 채워졌는가'로 센다.
-- 빈 껍데기 행이 완료로 잡혀 ja 2,450행 중 105건만 실물이던 전례가 있다.
-- 최소 길이 기준은 앱(_lib/seoTranslateBackfill.js MIN_TRANSLATED)과 같다.
create or replace function translate_health_stats(window_hours int default 3)
returns table (remaining bigint, produced bigint, done bigint, total_targets bigint)
language sql stable as $$
with langs(lang) as (
  values ('it'),('fr'),('es'),('ja'),('de'),('ru'),('zh')
),
targets as (
  select 'editorial'::text as kind, e.id
  from editorials e
  where e.status = 'published' and e.title is not null
    and length(btrim(coalesce(e.description_en, e.description, ''))) >= 30
  union all
  select 'article'::text, a.id
  from articles a
  where a.status = 'published' and a.title is not null
    and length(btrim(coalesce(a.content_en, a.content, ''))) >= 80
),
filled as (
  select t.kind, t.lang, t.content_id
  from seo_translations t
  where (t.kind = 'editorial' and length(btrim(coalesce(t.description,''))) >= 40)
     or (t.kind = 'article'   and length(btrim(coalesce(t.body,'')))        >= 100)
),
pairs as (
  select tg.kind, l.lang, tg.id as content_id
  from targets tg cross join langs l
)
select
  (select count(*) from pairs p
     where not exists (select 1 from filled f
                       where f.kind = p.kind and f.lang = p.lang and f.content_id = p.content_id)) as remaining,
  (select count(*) from seo_translations t
     where t.updated_at > now() - (window_hours || ' hours')::interval
       and ((t.kind = 'editorial' and length(btrim(coalesce(t.description,''))) >= 40)
         or (t.kind = 'article'   and length(btrim(coalesce(t.body,'')))        >= 100))) as produced,
  (select count(*) from pairs p
     where exists (select 1 from filled f
                   where f.kind = p.kind and f.lang = p.lang and f.content_id = p.content_id)) as done,
  (select count(*) from pairs) as total_targets;
$$;

-- 2026-07-31 적용 시점 실측: remaining 19,523 · done 9,240 / total 28,763 (32%)
