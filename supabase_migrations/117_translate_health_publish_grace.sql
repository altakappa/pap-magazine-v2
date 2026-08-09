-- 117 — 갓 발행한 콘텐츠는 '잔량'으로 세지 않는다 (발행 유예 30분) · 2026-08-09
--
-- ■ 증상 — 정상인데 경보가 울렸다
-- 2026-08-09 09:31:34 "🚨 번역 백필 정체 — 3시간 89회 실행에 저장 0건, 잔량 7건"
-- 초 단위로 맞춰 보니:
--     09:30:33  새 기사 발행 (「살갗을 부딪히던 서브컬처의 냉만은 어디로」)
--     09:31:34  pipeline-watch → 잔량 7(=1기사×7언어) · 최근 3시간 저장 0 → 경보
--     09:32:10  번역 크론이 7개 언어 전부 저장 (경보 36초 뒤)
-- 아무 문제도 없었다. 발행과 번역 사이의 ~2분 틈에 감시가 들어온 것뿐이다.
--
-- ■ 왜 이제서야 — 완주했기 때문에 생긴 문제다
-- 판정 규칙은 "잔량>0 인데 창(3h) 안에 저장 0 → 정체" 다.
-- 어제까지는 백필이 계속 돌아 '3시간 저장 0'이 될 일이 없었다.
-- 2026-08-09 전 조합 완주(32,053/32,053) 이후로는 **평상시가 저장 0** 이다.
-- 그래서 기사 하나만 새로 발행돼도 잔량이 0→7로 튀고, 그때 감시가 돌면 경보.
--
-- 실측 빈도: 최근 30일 발행 기사 1,875건(하루 62건). pipeline-watch 는 30분마다.
-- 취약 구간은 발행~번역 사이 ~2분. 쿨다운 6시간이 막아줘도 하루 1~4회 헛경보다.
-- 헛경보가 반복되면 도메니코가 이 알림을 무시하게 되고, 그러면 진짜 정체를
-- 놓친다 — 감시를 만든 이유가 통째로 무너진다.
--
-- ■ 고치는 방법 — 이 저장소가 이미 쓰는 해법
-- api/cron/pipeline-watch.js 14행:
--     "GRACE_HOURS 보다 오래된 게시물만 본다 — 방금 올린 건 아직 정상 대기 중이다."
-- IG 파이프라인 감시는 처음부터 유예를 갖고 있었다. 번역 감시에만 없었다.
-- 같은 것을 붙인다: **발행 30분 이내 콘텐츠는 targets 에서 뺀다.**
--
-- 왜 30분인가: 번역 크론은 2분마다 돈다 → 유예 안에 15번의 기회가 있다.
-- 실측 처리 시간은 97초였다. 30분을 넘겨도 안 되면 그건 진짜 정체이므로
-- 다음 pipeline-watch(30분 주기)에서 정상적으로 경보가 울린다.
-- 즉 **진짜 장애는 최대 30분 늦게 알려질 뿐, 놓치지 않는다.**
--
-- ■ 안 바꾸는 것
--   · produced 집계 — 유예와 무관하다. 갓 만든 번역도 '생산'이 맞다.
--   · done / total_targets — 진행률 표시용. 유예를 걸면 분모가 흔들려
--     "100%였다가 99.9%" 처럼 보인다. 여기서 빼는 건 **remaining 뿐**이다.
--   · CJK 문턱(116 이전 107) · 6,000자 상한 — 그대로.
--
-- ■ 되돌리기
--     107_translate_health_cjk_threshold.sql 을 다시 실행하면 유예가 사라진다.

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
-- ★ 117 신설 — 잔량 판정에서만 쓰는 '유예 지난 대상'.
-- 갓 올라온 글은 번역이 없는 게 정상이다. 이걸 잔량으로 세면 발행 때마다 경보가 운다.
aged as (
  select t.id, t.kind from targets t
  where exists (
    select 1 from public.articles a
    where t.kind = 'article' and a.id = t.id
      and a.created_at <= now() - interval '30 minutes'
  ) or exists (
    select 1 from public.editorials e
    where t.kind = 'editorial' and e.id = t.id
      and e.created_at <= now() - interval '30 minutes'
  )
),
filled as (
  select t.lang, t.content_id, t.kind
  from public.seo_translations t
  where (t.kind = 'article'
         -- CJK 는 같은 내용을 절반 이하 글자로 쓴다 → 문턱도 절반 이하.
         -- 앱의 minDoneFor() 와 같은 값이어야 한다.
         and length(btrim(coalesce(t.body,''))) >=
             (case when t.lang in ('ja','zh') then 40 else 100 end))
     or (t.kind = 'editorial' and length(btrim(coalesce(t.description,''))) >= 40)
),
-- 진행률(done/total)은 전체 대상 기준 — 분모가 흔들리지 않게 유예를 안 건다.
pairs as (
  select l.lang, tg.id as content_id, tg.kind from targets tg cross join langs l
),
-- 잔량만 유예 지난 대상 기준.
aged_pairs as (
  select l.lang, ag.id as content_id, ag.kind from aged ag cross join langs l
)
select
  (select count(*) from aged_pairs p
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
