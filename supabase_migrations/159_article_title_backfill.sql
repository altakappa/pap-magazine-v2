-- 159 — 제목·메타 설명을 실제 검색어에 맞춰 다시 쓰기 위한 표와 뷰 (2026-09-14)
--
-- [왜] 28일 실측에서 **순위로는 설명이 안 되는 구멍**이 나왔다.
--   튜이드              노출 5,057 · 클릭 1  · CTR 0.02% · 순위 6.4
--   나띠                노출 8,407 · 클릭 5  · CTR 0.06% · 순위 9.8
--   wooyoung           노출 5,143 · 클릭 3  · CTR 0.06% · 순위 9.9
--   jennie summer sonic 노출 4,780 · 클릭 9  · CTR 0.19% · 순위 6.6
-- 6.4위면 보통 CTR 이 3~5% 다. 우리는 0.02% 다. **보여도 안 눌린다.**
--
-- 본문 보강(158)은 **순위**를 올리는 일이고, 제목·설명은 **CTR** 을 올리는 일이다.
-- 그리고 훨씬 싸고 빠르다. 구글이 다시 긁으면 바로 반영된다.
--
-- [무엇이 문제인가 — 구체적으로]
--   검색어 "튜이드"(노출 5,057) 에 걸리는 우리 제목: "튜이드, 데뷔 타이틀 'SUN KISS' 공개"
--   "튜이드" 를 검색한 사람은 **이 그룹이 누구인지** 알고 싶다.
--   멤버도, 소속사도, 데뷔일도 제목에 없다. 검색한 사람 눈에 답으로 안 보인다.
--
-- [뷰가 하는 일] 기사마다 "어떤 검색어로 노출되는지" 를 알려준다.
-- GSC 는 query × page 교차를 우리 표에 주지 않으므로 **제목 문자열 매칭**으로 잇는다.
-- 거칠지만 실측으로 확인했다 (sawadika → 리사 기사 2편, 튜이드 → 튜이드 기사 3편).
--
-- [주의] 이 뷰도 표도 **아무것도 바꾸지 않는다.** 제목 교체는
-- api/admin/article-title-backfill.js 가 하고, 반영은 사람이 ?apply= 를 눌러야 한다.

create or replace view public.article_query_match as
with topq as (
  select
    query,
    sum(impressions)                                              as imp,
    sum(clicks)                                                   as clk,
    round(sum(position * impressions) / nullif(sum(impressions), 0), 1) as pos
  from public.gsc_query_daily
  where date >= current_date - 28
  group by query
  having sum(impressions) >= 500
     and length(query) >= 3
)
select
  a.id                                                   as article_id,
  (array_agg(t.query order by t.imp desc))[1:8]          as queries,
  (array_agg(t.imp   order by t.imp desc))[1:8]          as query_impressions,
  (array_agg(t.clk   order by t.imp desc))[1:8]          as query_clicks,
  (array_agg(t.pos   order by t.imp desc))[1:8]          as query_positions,
  sum(t.imp)::bigint                                     as matched_impressions
from public.articles a
join topq t
  /* 검색어에 % _ \ 가 있으면 와일드카드가 되므로 막는다 */
  on a.title ilike '%' || replace(replace(replace(t.query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
where a.status = 'published'
group by a.id;

comment on view public.article_query_match is
  '159 (2026-09-14) — 기사마다 어떤 검색어로 노출되는지. 제목 문자열 매칭으로 이었다(GSC 는 query×page 교차를 주지 않는다). 제목을 검색 의도에 맞추기 위한 근거.';

revoke all on public.article_query_match from anon, authenticated;
grant select on public.article_query_match to service_role;

-- ── 제목 교체 장부 ────────────────────────────────────────────────
-- article_body_backfill 과 같은 모양이다. 생성과 반영을 분리하고,
-- 원본을 통째로 보관해 언제든 되돌린다.
create table if not exists public.article_title_backfill (
  article_id    uuid primary key references public.articles(id) on delete cascade,
  impressions   bigint,
  clicks        bigint,
  ctr           numeric,
  avg_position  numeric,
  queries       text[],                       -- 근거가 된 검색어
  old_title     text,
  new_title     text,
  old_desc      text,                         -- seo_description 원본
  new_desc      text,
  note          text,                         -- 왜 이렇게 고쳤는지
  status        text not null default 'queued', -- queued | draft | applied | rejected | reverted
  generated_at  timestamptz,
  applied_at    timestamptz
);

comment on table public.article_title_backfill is
  '159 (2026-09-14) — 제목·메타 설명 교체 장부. old_title/old_desc 에 원본을 통째로 보관해 되돌릴 수 있다. 반영은 사람이 누른다.';

create index if not exists article_title_backfill_status_idx
  on public.article_title_backfill (status, impressions desc);

alter table public.article_title_backfill enable row level security;
revoke all on public.article_title_backfill from anon, authenticated;
grant all on public.article_title_backfill to service_role;
