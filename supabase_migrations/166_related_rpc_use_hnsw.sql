-- 166 (2026-09-23) — 추천 RPC 두 개가 벡터 인덱스를 타게 한다 + custom_url 인덱스.
--
-- [왜] Ahrefs 9/22 크롤에서 번역 기사 99쪽의 첫 응답이 8~15초였다 (직전 크롤 약 0.5초).
--   DB 쿼리 통계(pg_stat_statements, 2026-04-06 이후 누적)를 보니
--   related_articles 한 함수가 120만 번, 평균 72.7ms, 합계 87,631초로
--   DB 전체 실행 시간 263,799초의 33%를 혼자 썼다. 기사 페이지를 그릴 때마다 부른다.
--
-- [원인] HNSW 인덱스(articles_embedding_hnsw)가 있는데도 안 탔다.
--   기준 벡터를 (select embedding ...) base 로 '조인' 해서 정렬했기 때문에
--   플래너가 인덱스 정렬을 못 쓰고, 발행 기사 2,741편과의 거리를 전부 계산한 뒤 정렬했다.
--   EXPLAIN: Nested Loop → Sort, 버퍼 34,417, 65.8ms.
--
-- [고침] 기준 벡터를 정렬식 안의 스칼라 서브쿼리로 옮긴다 (한 번만 계산되는 InitPlan).
--   그러면 Index Scan using articles_embedding_hnsw 가 된다. 버퍼 1,026, 약 5~7ms.
--   HNSW 는 근사 검색이다. 적용 전에 150편 표본으로 정확 검색과 비교해
--   600칸 중 598칸 일치(99.7%)를 확인했다.
--   반환형·인자·이름은 그대로라 DROP 이 필요 없다 (147 교훈).
--   기준 기사에 임베딩이 없으면 종전처럼 0행을 돌려준다 (where 절 가드).
--
-- related_editorials 도 똑같은 모양이라 같이 고친다 (2만 번, 평균 53.5ms). 표본 150편 600칸 모두 일치.
--
-- [덤] 기사 SSR 의 첫 조회가 custom_url = $1 인데 인덱스가 없어 매번 전체를 훑었다
--   (버퍼 421). 값이 있는 457행, 중복 0. 일반 btree 인덱스를 단다.

create or replace function public.related_articles(target_id uuid, match_count integer default 4)
returns table(id uuid, title character varying, slug character varying, thumbnail text, similarity double precision)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    a.id,
    a.title,
    a.slug,
    coalesce(a.thumbnail_url, a.hero_image_url) as thumbnail,
    1 - (a.embedding <=> (select b.embedding from articles b where b.id = target_id)) as similarity
  from articles a
  where a.id <> target_id
    and a.status = 'published'
    and a.embedding is not null
    and (select b.embedding from articles b where b.id = target_id) is not null
  order by a.embedding <=> (select b.embedding from articles b where b.id = target_id)
  limit match_count;
$function$;

create or replace function public.related_editorials(target_id uuid, match_count integer default 4)
returns table(id uuid, title character varying, slug character varying, cover_image text, similarity double precision)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    e.id,
    e.title,
    e.slug,
    e.cover_image,
    1 - (e.embedding <=> (select b.embedding from editorials b where b.id = target_id)) as similarity
  from editorials e
  where e.id <> target_id
    and e.status = 'published'
    and e.embedding is not null
    and (select b.embedding from editorials b where b.id = target_id) is not null
  order by e.embedding <=> (select b.embedding from editorials b where b.id = target_id)
  limit match_count;
$function$;

create index if not exists idx_articles_custom_url on public.articles using btree (custom_url);
