-- 158 — "노출은 큰데 순위가 낮은 기사" 를 한 줄로 보는 뷰 (2026-09-14)
--
-- [왜] 도메니코: "1~3위로 올리는 작업 하자."
-- 어디부터 손댈지는 감이 아니라 실측으로 정해야 한다. 우리 DB 에는 이미
-- gsc_page_daily(22만 행, 9/11까지)가 있다. 그걸 쓴다.
--
-- [핵심 — 언어판을 합산한다]
-- 같은 기사가 /article/x · /en/article/x · /ja/article/x · /es/article/x … 로
-- 흩어져 있다. 페이지 단위로 보면 우선순위가 틀린다. 실측 예:
--   /es/  제니 아디다스 발레코어  17,207
--   /ja/  같은 기사               9,303
--   /     같은 기사               7,128
--   … 합치면 **46,472** 로 1위다. 페이지 단위로는 3등쯤으로 보였다.
--
-- [왜 본문 길이를 같이 보나] 2026-09-14 실측에서 관계가 분명했다.
--   본문 812자 → 순위 3.5위, CTR 21.3%  (서도호 전시, ja)
--   본문 337자 → 순위 8.5위, CTR 0.54% (제니 서머소닉 CK)
--   본문 405자 → 순위 6.5위, CTR 0.18% (튜이드 SUN KISS)
-- 발행 기사 평균 본문이 545자, 72.5%가 600자 미만이다(2026-08-17 조사).
-- 노출이 이미 나오는 기사의 본문만 두껍게 해도 순위가 움직인다.
--
-- [주의] 이 뷰는 **아무것도 바꾸지 않는다.** 무엇부터 손댈지 고르는 눈이다.
-- 본문을 실제로 고치는 것은 api/admin/article-body-backfill.js 이고,
-- 반영은 사람이 ?apply= 를 눌러야 일어난다.

create or replace view public.article_seo_opportunity as
with page28 as (
  select
    /* 언어 프리픽스를 벗겨 같은 기사로 모은다 */
    regexp_replace(regexp_replace(page, '^https?://[^/]+', ''), '^/(en|ja|it|fr|es|de|zh|ru)/', '/') as path,
    sum(impressions)               as imp,
    sum(clicks)                    as clk,
    sum(position * impressions)    as posw
  from public.gsc_page_daily
  where date >= current_date - 28
    and page like '%/article/%'
  group by 1
)
select
  a.id                                                            as article_id,
  coalesce(a.custom_url, a.slug)                                  as slug,
  a.title                                                         as title,
  a.published_date                                                as published_date,
  length(regexp_replace(coalesce(a.content, ''), '<[^>]+>', '', 'g')) as body_len,
  sum(p.imp)::bigint                                              as impressions,
  sum(p.clk)::bigint                                              as clicks,
  round(100.0 * sum(p.clk) / nullif(sum(p.imp), 0), 2)            as ctr,
  round(sum(p.posw) / nullif(sum(p.imp), 0), 1)                   as avg_position
from public.articles a
join page28 p
  on p.path = '/article/' || coalesce(a.custom_url, a.slug)
where a.status = 'published'
group by a.id, a.custom_url, a.slug, a.title, a.published_date, a.content;

comment on view public.article_seo_opportunity is
  '158 (2026-09-14) — 최근 28일 GSC 를 기사 단위로 합산(언어판 포함). 노출·클릭·CTR·평균순위·본문자수. 무엇부터 보강할지 고르는 눈.';

revoke all on public.article_seo_opportunity from anon, authenticated;
grant select on public.article_seo_opportunity to service_role;
