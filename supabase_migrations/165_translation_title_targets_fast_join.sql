-- 165 (2026-09-22) — translation_title_targets 속도 개선. 결과는 161 과 한 행도 다르지 않다.
--
-- [왜] ?queue=1 의 "남은대상" 이 0 으로 나왔다. 실제로는 4,394건이었다.
--   이 뷰 count 가 3.9초, 관리자 API 한 번에 7.6초가 걸렸고, PostgREST 의
--   statement_timeout 은 8초다. 느린 날엔 시간 초과가 났고, 코드가 에러를
--   버리고 "0" 을 돌려줬다(코드 쪽은 같은 커밋에서 에러를 드러내게 고쳤다).
--
-- [원인] 기사 조인이 (g.handle = a.slug or g.handle = a.custom_url) 였다.
--   OR 조건은 해시 조인을 못 써서 9,578 × 2,723 = 2,600만 번을 비교했다.
--
-- [고침] slug 와 custom_url 을 행으로 펼쳐(ah) 같음 조인 하나로 바꿨다.
--   3.9초 → 1.1초. 적용 전에 새 정의와 옛 뷰를 EXCEPT ALL 로 양방향 비교해
--   only_new 0, only_old 0 을 확인했다. 컬럼 이름·순서·타입은 그대로다.

create or replace view public.translation_title_targets as
with page as (
  select
    substring(regexp_replace(g.page, '^https?://[^/]+', '') from 2 for 2) as lang,
    regexp_replace(regexp_replace(g.page, '^https?://[^/]+', ''),
                   '^/(it|fr|es|de|ru)/article/', '')                    as handle,
    g.impressions,
    g.clicks,
    g.position
  from public.gsc_page_daily g
  where g.date >= current_date - 28
    and regexp_replace(g.page, '^https?://[^/]+', '') ~ '^/(it|fr|es|de|ru)/article/'
), agg as (
  select
    lang,
    handle,
    sum(impressions)::bigint as impressions,
    sum(clicks)::bigint      as clicks,
    round(sum(position * impressions) / nullif(sum(impressions), 0), 1) as avg_position
  from page
  group by lang, handle
), ah as (
  /* 기사 하나가 slug 와 custom_url 두 주소를 가질 수 있다. 둘을 행으로 펼쳐
     같음(=) 조인 하나로 만든다. OR 조인은 해시 조인을 못 써서 2,600만 번 비교했다. */
  select distinct a.id, a.slug, a.title, h.handle
  from public.articles a
  cross join lateral unnest(array[a.slug, a.custom_url]) as h(handle)
  where a.status = 'published'
    and h.handle is not null
)
select
  t.content_id,
  t.lang,
  a.slug,
  a.title                        as ko_title,
  t.title                        as cur_title,
  char_length(t.title)           as cur_len,
  g.impressions,
  g.clicks,
  round(100.0 * g.clicks / nullif(g.impressions, 0), 2) as ctr,
  g.avg_position
from public.seo_translations t
join ah a
  on a.id = t.content_id
join agg g
  on g.lang = t.lang
 and g.handle = a.handle
where t.kind = 'article'
  and t.lang in ('it', 'fr', 'es', 'de', 'ru')
  and t.title is not null
  and char_length(t.title) > 60;


revoke all on public.translation_title_targets from anon, authenticated;
grant select on public.translation_title_targets to service_role;
