-- 106 · 감시 함수에서 90일 나이 컷 제거 (2026-08-06)
--
-- ── 왜 ──────────────────────────────────────────────────────────────
-- 앱이 2026-08-06 부터 나이 컷 없이 전량 번역한다
-- (api/cron/backfill-translations.js — SEO_TRANSLATE_MAX_AGE_DAYS 기본 90 → 0).
--
-- 근거는 검색이 아니라 사이트 경험이다:
--   api/seo/article/[slug].js:167 — 번역이 없으면 비-ko/en 방문자를 /en 으로
--   302 리다이렉트한다. 발행 기사 2,282편 중 자국어로 볼 수 있는 비율은
--       it·es 74.5% · fr 69.9% · ja 58.5% · ru 27.2% · de 24.9% · zh 22.4%
--   중국어 구독자는 기사 10개 중 8개가 영어로 튕긴다. PAP 은 9개 언어
--   커뮤니티 플랫폼을 지향하므로 이 상태를 두면 안 된다.
--   근거 문서: 볼트 45_Business/PAP_기사번역_전량검토_2026-08-06.md
--
-- ── 왜 감시 함수도 같이 고쳐야 하나 ──────────────────────────────────
-- 103 의 translate_health_stats 는 `published_date >= current_date - 90` 을
-- 하드코딩하고 있다. 앱만 바꾸면 감시가 실제 대상의 일부만 세게 되고,
-- '잔량이 갑자기 늘었다/줄었다' 를 설명할 수 없게 된다.
-- 2026-08-05 에 정확히 반대 방향으로 같은 사고가 났다 — 감시가 컷을 모른 채
-- 전체를 세어 '잔량 8,124건' 오경보를 올렸고 실제 대상은 181건이었다.
-- **앱과 감시는 항상 같은 정의를 써야 한다.**
--
-- ── 유지되는 것 ─────────────────────────────────────────────────────
-- 6,000자 상한은 그대로다. 나이와 근거가 다르다 — zh 성공 329건의 원문
-- 최대가 2,293자이고 6,000자 초과 성공은 0건이다(103 참고). 이건 품질이
-- 아니라 호출 타임아웃 문제이므로 전량 번역과 무관하게 살려 둔다.
--
-- 시그니처는 그대로 두어 pipeline-watch.js 호출부는 손대지 않는다.

create or replace function public.translate_health_stats(window_hours int default 3)
returns table (remaining bigint, produced bigint, done bigint, total_targets bigint)
language sql stable as $$
with langs(lang) as (
  values ('it'),('fr'),('es'),('ja'),('de'),('ru'),('zh')
),
targets as (
  -- 2026-08-06: 나이 컷 없음. 앱(SEO_TRANSLATE_MAX_AGE_DAYS 기본 0)과 같은 정의.
  -- 6,000자 상한만 남는다 (SEO_TRANSLATE_MAX_SRC_CHARS 기본값과 일치해야 한다).
  select a.id, 'article'::text as kind
  from public.articles a
  where a.status = 'published' and a.title is not null
    and length(btrim(coalesce(a.content_en, a.content, ''))) >= 80
    and length(coalesce(a.content_en, a.content, '')) <= 6000
  union all
  select e.id, 'editorial'::text
  from public.editorials e
  where e.status = 'published' and e.title is not null
    and length(btrim(coalesce(e.description_en, e.description, ''))) >= 30
),
filled as (
  select t.lang, t.content_id, t.kind
  from public.seo_translations t
  where (t.kind = 'article'   and length(btrim(coalesce(t.body,'')))        >= 100)
     or (t.kind = 'editorial' and length(btrim(coalesce(t.description,''))) >= 40)
),
pairs as (
  select l.lang, tg.id as content_id, tg.kind from targets tg cross join langs l
)
select
  (select count(*) from pairs p
     where not exists (select 1 from filled f
                       where f.lang = p.lang and f.content_id = p.content_id and f.kind = p.kind)) as remaining,
  (select count(*) from public.seo_translations t
     where t.updated_at > now() - (window_hours || ' hours')::interval
       and ((t.kind = 'article'   and length(btrim(coalesce(t.body,'')))        >= 100)
         or (t.kind = 'editorial' and length(btrim(coalesce(t.description,''))) >= 40))) as produced,
  (select count(*) from pairs p
     where exists (select 1 from filled f
                   where f.lang = p.lang and f.content_id = p.content_id and f.kind = p.kind)) as done,
  (select count(*) from pairs) as total_targets
$$;

-- ───────────────────────────────────────────────────────────────
-- 검증
-- ───────────────────────────────────────────────────────────────
-- 1) 잔량이 실제 미번역 수와 맞는가 (2026-08-06 기준 기대: 아티클 7,921 + 에디토리얼 잔여)
-- select * from translate_health_stats(3);
-- 2) 큐가 나이 제한 없이 오래된 기사를 돌려주는가
-- select title, src_len from seo_translate_queue_article('zh',3,100,80,null,6000);
