-- 100 · 번역 백필 큐를 서버에서 고른다 (2026-08-05)
--
-- 왜 만드나 — 실측:
--   runBackfillBatch 는 호출 한 번마다 두 개의 큰 표를 **통째로** 내려받았다.
--     ① articles(status='published') 전량 + content/content_en  →  6.26 MB
--     ② seo_translations(kind,lang) 전량 + body                 →  2.33 MB (it 기준)
--   목적은 단 두 가지였다 — "이 행의 번역이 이미 채워졌나(길이 ≥ 100)" 와
--   "원본이 번역할 만큼 긴가(길이 ≥ 80)". 즉 **길이 두 개를 알려고 8.5 MB 를
--   옮기고 있었다.** 그것도 언어마다 따로, 크론 한 번에 3~10 회.
--   2분 주기 × 24시간이면 하루 수십 GB 다. 실제로 저장되는 건 시간당 60여 건.
--
--   같은 일을 하는 형제 크론 backfill-meta-desc 는 이미 서버측 함수
--   (short_desc_editorials)로 큐를 고르고 있고 실행시간이 0.5초다.
--   backfill-translations 만 83초였다. 규칙이 아니라 예외였던 쪽을 고친다.
--
-- 무엇을 하나 — 선별을 전부 Postgres 안에서 끝내고, **실제로 번역할 몇 건만**
-- 돌려준다. 실측: 큐 조회 21.9 ms / 카운트 66.9 ms (EXPLAIN ANALYZE, 2026-08-05).
--
-- 판정 기준(길이 임계값)은 이 파일이 아니라 **앱이 인자로 넘긴다**
-- (_lib/seoTranslateBackfill.js 의 MIN_TRANSLATED · EDITORIAL_SRC_MAX).
-- 같은 숫자를 두 곳에 적어두면 한쪽만 바뀌는 사고가 난다 — 이 저장소가
-- 이미 여러 번 겪은 패턴이라 단일 출처를 앱 쪽에 둔다.
--
-- 안전성: 읽기 전용(stable) 함수 두 개만 추가한다. 표·컬럼·데이터 변경 없음.
-- 이 마이그레이션을 적용하지 않아도 앱은 예전 경로로 그대로 동작한다
-- (앱이 rpc 실패를 잡아 폴백한다) — 배포 순서에 매이지 않는다.

-- ───────────────────────────────────────────────────────────────
-- SECTION 1 — 큐: 실제로 번역할 대상만 (최신 발행 우선)
-- ───────────────────────────────────────────────────────────────
create or replace function public.seo_translate_queue(
  p_kind     text,
  p_lang     text,
  p_limit    int  default 5,
  p_min_done int  default 40,     -- 번역이 '있다'고 인정할 최소 길이
  p_min_src  int  default 30,     -- 원본이 '번역할 만하다'고 볼 최소 길이
  p_src_max  int  default 0       -- 원본 전송 상한 (0 = 자르지 않음)
)
returns table (
  id       uuid,
  title    text,
  title_en text,
  src      text,   -- 번역할 원문 (editorial=설명, article=본문)
  extra    text,   -- editorial 전용: description_it (it fast-path)
  src_len  int
)
language sql stable as $$
  -- 에디토리얼
  select e.id,
         e.title::text,
         e.title_en,
         case when p_src_max > 0
              then left(coalesce(e.description_en, e.description, ''), p_src_max)
              else coalesce(e.description_en, e.description, '') end,
         e.description_it,
         length(coalesce(e.description_en, e.description, ''))::int
  from public.editorials e
  where p_kind = 'editorial'
    and e.status = 'published'
    and e.title is not null
    and (
      (p_lang = 'it' and length(btrim(coalesce(e.description_it, ''))) > 0)
      or length(btrim(coalesce(e.description_en, e.description, ''))) >= p_min_src
    )
    and not exists (
      select 1 from public.seo_translations t
      where t.kind = 'editorial' and t.lang = p_lang and t.content_id = e.id
        and length(btrim(coalesce(t.description, ''))) >= p_min_done
    )
  order by e.published_date desc nulls last
  limit case when p_kind = 'editorial' then greatest(p_limit, 1) else 0 end
$$;

-- 아티클은 반환 컬럼 의미가 같지만 원본 표가 달라 UNION 대신 별도 함수로 둔다
-- (한 함수 안에서 두 표를 UNION 하면 플래너가 양쪽을 다 훑는다).
create or replace function public.seo_translate_queue_article(
  p_lang     text,
  p_limit    int default 5,
  p_min_done int default 100,
  p_min_src  int default 80
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
    and length(btrim(coalesce(a.content_en, a.content, ''))) >= p_min_src
    and not exists (
      select 1 from public.seo_translations t
      where t.kind = 'article' and t.lang = p_lang and t.content_id = a.id
        and length(btrim(coalesce(t.body, ''))) >= p_min_done
    )
  order by a.published_date desc nulls last
  limit greatest(p_limit, 1)
$$;

-- ───────────────────────────────────────────────────────────────
-- SECTION 2 — 카운트: 잔여 / 원본없음
--   이 둘을 뭉뚱그리면 "원본이 안 채워져 멈춘 상태"를 완주로 착각한다
--   (2026-07-30 ja 사고와 같은 계열). 그래서 나눠서 돌려준다.
-- ───────────────────────────────────────────────────────────────
create or replace function public.seo_translate_counts(
  p_kind     text,
  p_lang     text,
  p_min_done int default 40,
  p_min_src  int default 30
)
returns table (remaining bigint, no_source bigint)
language sql stable as $$
  select
    count(*) filter (where has_src)     as remaining,
    count(*) filter (where not has_src) as no_source
  from (
    select (
             (p_lang = 'it' and length(btrim(coalesce(e.description_it, ''))) > 0)
             or length(btrim(coalesce(e.description_en, e.description, ''))) >= p_min_src
           ) as has_src
    from public.editorials e
    where p_kind = 'editorial'
      and e.status = 'published' and e.title is not null
      and not exists (
        select 1 from public.seo_translations t
        where t.kind = 'editorial' and t.lang = p_lang and t.content_id = e.id
          and length(btrim(coalesce(t.description, ''))) >= p_min_done
      )
    union all
    select length(btrim(coalesce(a.content_en, a.content, ''))) >= p_min_src
    from public.articles a
    where p_kind = 'article'
      and a.status = 'published' and a.title is not null
      and not exists (
        select 1 from public.seo_translations t
        where t.kind = 'article' and t.lang = p_lang and t.content_id = a.id
          and length(btrim(coalesce(t.body, ''))) >= p_min_done
      )
  ) q
$$;

-- ───────────────────────────────────────────────────────────────
-- SECTION 3 — 권한
--   서버(api/*)는 service_role 로 붙는다. anon/authenticated 에게는
--   줄 이유가 없다 — 미발행 원문 길이까지 노출할 필요가 없다.
-- ───────────────────────────────────────────────────────────────
revoke all on function public.seo_translate_queue(text, text, int, int, int, int)  from public, anon, authenticated;
revoke all on function public.seo_translate_queue_article(text, int, int, int)     from public, anon, authenticated;
revoke all on function public.seo_translate_counts(text, text, int, int)           from public, anon, authenticated;
grant execute on function public.seo_translate_queue(text, text, int, int, int, int) to service_role;
grant execute on function public.seo_translate_queue_article(text, int, int, int)    to service_role;
grant execute on function public.seo_translate_counts(text, text, int, int)          to service_role;

-- ───────────────────────────────────────────────────────────────
-- SECTION 4 — 검증 (적용 후 실행)
-- ───────────────────────────────────────────────────────────────
-- 1) 아티클 큐 2건이 나오고 20ms 대인가
-- explain analyze select * from seo_translate_queue_article('de', 2, 100, 80);
--
-- 2) 카운트가 크론 로그의 '남N' 과 일치하는가
-- select * from seo_translate_counts('article', 'de', 100, 80);
-- select * from seo_translate_counts('editorial', 'it', 40, 30);
--
-- 3) 권한 — service_role 만 보여야 한다
-- select p.proname, r.rolname
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   cross join lateral aclexplode(p.proacl) a
--   join pg_roles r on r.oid = a.grantee
--  where n.nspname='public' and p.proname like 'seo_translate%';
