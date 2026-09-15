-- 161 — 언어판 제목이 검색 결과에서 잘리는 문제 (2026-09-15)
--
-- [왜] Ahrefs Site Audit(9/15 크롤, 10,031페이지) 경고 1,623건 중 1,338건이
-- "Title too long" 이고, 열어 보면 전부 /fr /de /es /it /ru 언어판이었다.
-- DB 전수 실측 (seo_translations, kind='article'):
--
--   언어  60자 초과   평균   최장
--   fr     1,395      39자   123자
--   de     1,352      39자   133자
--   es     1,352      38자   119자
--   it     1,289      38자   133자
--   ru     1,172      38자   127자
--   ja         9      23자    75자
--   zh         3      20자    71자
--
-- 한글 제목을 유럽 언어로 옮기면 글자 수가 두세 배로 늘어난다. ja/zh 는
-- 글자가 압축적이라 같은 프롬프트로도 문제가 없다.
--
-- [이미 고쳐진 것] 생성 쪽 상한은 2026-08-20 커밋 b23b31b 가 걸었다
-- (seoTranslateBackfill.js TITLE_MAX). 효과는 실측으로 확인된다:
--   8/20 이전 생성분  fr 57.7% · de 56.0% · es 56.0% · it 53.4% · ru 48.7% 가 60자 초과
--   8/20 이후 생성분  fr  4.6% · de  4.2% · es  3.1% · it  3.1% · ru  1.9%
-- 즉 남은 6,572건은 **전부 레거시**다. 프롬프트를 또 고칠 일이 아니라
-- 기존 행을 되쓰는 백필 도구가 없었던 것이 문제다. 158/159 와 같은 구멍이다.
--
-- [왜 이게 돈이 되나] 28일 GSC 실측 — 제목이 짧은 언어와 긴 언어의 CTR 차이:
--   ja  노출 142,574 · 클릭 7,780 · CTR 5.5%   (제목 평균 23자)
--   es  노출 132,862 · 클릭 1,470 · CTR 1.1%   (제목 평균 38자, 56%가 60자 초과)
--   fr  노출  74,095 · 클릭 1,660 · CTR 2.2%
--   ru  노출  69,546 · 클릭 1,511 · CTR 2.2%
--   it  노출  62,920 · 클릭 1,027 · CTR 1.6%
--   de  노출  51,142 · 클릭   737 · CTR 1.4%
-- 원인이 제목 길이 하나뿐이라고 말할 수는 없다. 다만 잘린 제목이 CTR 을
-- 깎는다는 것은 확립된 사실이고, 우리 데이터의 방향도 그것과 일치한다.
--
-- [범위] 노출이 실제로 잡힌 것만 고친다 (도메니코 결정, 9/15).
-- 60자 초과 대상 4,293건 중 상위 104건이 노출의 60%, 206건이 68%,
-- 555건이 80% 를 가져간다. 전량이 아니라 위에서부터 훑는 게 맞다.
--
-- [주의] 뷰도 표도 아무것도 바꾸지 않는다. 제목 교체는
-- api/admin/translation-title-backfill.js 가 하고, 반영은 사람이 ?apply= 를 누른다.

-- ── 대상 뷰 ───────────────────────────────────────────────────────
-- 157(image_shrink_targets)의 교훈을 그대로 따른다: "무엇이 남았나" 를
-- 코드가 아니라 DB 가 판단한다. 코드에서 거르면 상위가 막혔을 때
-- 조용히 빈 배열이 나오고 도구가 헛돈다.
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
join public.articles a
  on a.id = t.content_id
 and a.status = 'published'
join agg g
  on g.lang = t.lang
 and (g.handle = a.slug or g.handle = a.custom_url)
where t.kind = 'article'
  and t.lang in ('it', 'fr', 'es', 'de', 'ru')
  and t.title is not null
  and char_length(t.title) > 60;

comment on view public.translation_title_targets is
  '161 (2026-09-15) — 60자를 넘어 검색 결과에서 잘리는 언어판 제목 중, 최근 28일 GSC 노출이 실제로 잡힌 것. 노출이 0인 것은 고쳐도 확인할 방법이 없어 제외한다.';

revoke all on public.translation_title_targets from anon, authenticated;
grant select on public.translation_title_targets to service_role;

-- ── 교체 장부 ─────────────────────────────────────────────────────
-- 159 와 같은 모양이되 키가 (content_id, lang) 복합이다.
-- 같은 기사의 독일어판과 러시아어판은 서로 다른 건이다.
create table if not exists public.translation_title_backfill (
  content_id    uuid not null references public.articles(id) on delete cascade,
  lang          text not null,
  impressions   bigint,
  clicks        bigint,
  ctr           numeric,
  avg_position  numeric,
  ko_title      text,                          -- 근거가 된 한글 원제
  old_title     text,                          -- seo_translations.title 원본
  old_len       integer,
  new_title     text,
  new_len       integer,
  note          text,                          -- 무엇을 덜어냈는지 한 줄
  status        text not null default 'queued',-- queued | draft | applied | rejected | reverted
  generated_at  timestamptz,
  applied_at    timestamptz,
  primary key (content_id, lang)
);

comment on table public.translation_title_backfill is
  '161 (2026-09-15) — 언어판 제목 단축 장부. old_title 에 원본을 통째로 보관해 언제든 되돌린다. 반영은 사람이 누른다.';

create index if not exists translation_title_backfill_status_idx
  on public.translation_title_backfill (status, impressions desc);

alter table public.translation_title_backfill enable row level security;
revoke all on public.translation_title_backfill from anon, authenticated;
grant all on public.translation_title_backfill to service_role;
