-- 129 — 기사 번역 큐가 FAQ 원문도 함께 돌려준다 (2026-08-17)
--
-- [왜] GEO 절충안(도메니코 승인): 신규 기사 번역 시 FAQ({q,a} 배열)도 같은
-- Claude 호출에서 번역한다. 큐 RPC 가 faq 를 안 돌려주면 앱이 articles 표를
-- 다시 읽어야 하는데, 그건 100번 마이그레이션이 없앤 왕복을 되살리는 짓이다
-- (가드: tests/translate-queue-rpc.test.js "articles 표를 통째로 읽지 않는다").
-- 그래서 큐 반환 컬럼에 faq 를 추가한다. 반환 타입이 바뀌므로 drop 후 재생성.
--
-- [주의] 시그니처는 103 과 동일 (text,int,int,int,date,int). 앱 코드는
-- r.faq 가 없으면(구버전 함수) FAQ 없이 본문만 번역한다 — 배포 순서 무관 안전.

drop function if exists public.seo_translate_queue_article(text, int, int, int, date, int);

create or replace function public.seo_translate_queue_article(
  p_lang     text,
  p_limit    int  default 5,
  p_min_done int  default 100,
  p_min_src  int  default 80,
  p_since    date default null,
  p_max_src  int  default 0      -- 0 = 상한 없음 (관리자 수동 경로)
)
returns table (
  id       uuid,
  title    text,
  title_en text,
  src      text,
  extra    text,
  src_len  int,
  faq      jsonb
)
language sql stable as $$
  select a.id,
         a.title::text,
         a.title_en,
         coalesce(a.content_en, a.content, ''),
         null::text,
         length(coalesce(a.content_en, a.content, ''))::int,
         a.faq
  from public.articles a
  where a.status = 'published'
    and a.title is not null
    and (p_since is null or a.published_date >= p_since)
    and length(btrim(coalesce(a.content_en, a.content, ''))) >= p_min_src
    and (p_max_src <= 0 or length(coalesce(a.content_en, a.content, '')) <= p_max_src)
    and not exists (
      select 1 from public.seo_translations t
      where t.kind = 'article' and t.lang = p_lang and t.content_id = a.id
        and length(btrim(coalesce(t.body, ''))) >= p_min_done
    )
  order by a.published_date desc nulls last
  limit greatest(p_limit, 1)
$$;

revoke all on function public.seo_translate_queue_article(text, int, int, int, date, int) from public, anon, authenticated;
grant execute on function public.seo_translate_queue_article(text, int, int, int, date, int) to service_role;
