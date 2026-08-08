-- 107 — translate_health_stats 의 완료 기준을 CJK 에 맞춘다 (2026-08-09)
--
-- ■ 왜 필요한가 (실측)
--
-- 2026-08-09 05:15 경보: "번역 백필 정체 — 90회 실행에 저장 0건, 잔량 38건".
-- 그런데 크론 note 는 `처리 대상 없음 · 완주14` — 할 일이 없다고 한다.
-- 둘 다 맞다. **기준이 다르기 때문이다.**
--
-- 38건의 정체를 재보니:
--     아티클 ja  18건 = 진짜 없음 2 + **40~99자로 이미 있음 16**
--     아티클 zh  20건 = 진짜 없음 2 + **40~99자로 이미 있음 18**
--     에디토리얼  0건
-- 즉 **34건(89%)이 이미 번역돼 있는데 '없다'고 세고 있었다.**
--
-- ■ 원인은 내(Claude) 누락이다
--
-- 2026-08-08 에 ja 아티클 944건이 한 건에 막힌 사고를 고치면서, 완료로
-- 인정하는 최소 길이를 CJK 만 100 → 40 으로 낮췄다. 같은 내용을 한자·가나로
-- 쓰면 알파벳의 절반도 안 되기 때문이다(실측 평균 본문: de 1,435 vs ja 625 ·
-- zh 414). 그때 **앱(JS)만 고치고 이 SQL 함수는 안 고쳤다.**
--
-- 그 결과 경보는 영원히 울린다 — 크론이 아무리 돌아도 이 함수 기준으로는
-- 34건이 절대 안 줄어든다. 늑대가 없는데 계속 늑대라고 외치는 상태다.
-- `api/_lib/seoTranslateBackfill.js` 의 minDoneFor() 주석이 경고하던
-- "두 곳에 따로 적으면 한쪽만 바뀐다" 를 내가 그대로 밟았다.
--
-- ■ 무엇을 바꾸나
--
-- filled 판정에서 아티클 본문 기준을 언어별로 나눈다:
--     ja · zh → 40자   (JS 의 CJK_DONE_RATIO 0.4 와 같은 값)
--     그 외    → 100자  (기존 그대로)
-- 에디토리얼 description(40)은 **건드리지 않는다** — ja 에디토리얼에
-- 16~39자 행이 178건 있어서, 낮추면 그게 통째로 '완료'가 된다.
-- 정상인지 잘린 것인지 아직 안 재봤다(재보고 따로 판단할 것).
--
-- 6,000자 상한도 그대로 둔다 — 크론이 제외하는 긴 글을 여기서 세면
-- '영원히 안 줄어드는 잔량' 이 또 생긴다(그건 관리자 「긴 글 번역」 담당).
--
-- ■ 적용 후 기대값
--     remaining 38 → 4   (그 4건은 진짜다: 5,643자·5,909자 기사의 ja·zh)
--
-- ■ 되돌리기
--     106_translate_health_no_age_cut.sql 을 다시 실행하면 이전 정의로 돌아간다.

CREATE OR REPLACE FUNCTION public.translate_health_stats(window_hours integer DEFAULT 3)
 RETURNS TABLE(remaining bigint, produced bigint, done bigint, total_targets bigint)
 LANGUAGE sql
 STABLE
AS $function$
with langs(lang) as (
  values ('it'),('fr'),('es'),('ja'),('de'),('ru'),('zh')
),
targets as (
  select a.id, 'article'::text as kind
  from public.articles a
  where a.status = 'published' and a.title is not null
    and length(btrim(coalesce(a.content_en, a.content, ''))) >= 80
    -- 크론이 길이로 제외하는 건 여기서도 세지 않는다(관리자 수동 경로 담당).
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
  where (t.kind = 'article'
         -- CJK 는 같은 내용을 절반 이하 글자로 쓴다 → 문턱도 절반 이하.
         -- 앱의 minDoneFor() 와 같은 값이어야 한다. 한쪽만 바꾸면 경보가
         -- 영원히 울거나(이번 사고) 다 됐다고 착각한다.
         and length(btrim(coalesce(t.body,''))) >=
             (case when t.lang in ('ja','zh') then 40 else 100 end))
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
       and ((t.kind = 'article'
             and length(btrim(coalesce(t.body,''))) >=
                 (case when t.lang in ('ja','zh') then 40 else 100 end))
         or (t.kind = 'editorial' and length(btrim(coalesce(t.description,''))) >= 40))) as produced,
  (select count(*) from pairs p
     where exists (select 1 from filled f
                   where f.lang = p.lang and f.content_id = p.content_id and f.kind = p.kind)) as done,
  (select count(*) from pairs) as total_targets
$function$;
