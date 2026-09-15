-- 162. 화보 title_en 이 비는 것을 쓰기 시점에 막는다 (2026-09-15)
--
-- [무엇이 있었나] editorials 2,537건 중 22건의 title_en 이 비어 있었다.
-- 발행 7건, 초안 15건. 오늘 전부 title 값으로 채웠다.
--
-- [실측] 채우기 전에 잰 것:
--   · 22건 전부 title 에 한글이 없다 (title 자체가 이미 영문 원제).
--   · 화보 전체 2,537건 중 title 에 한글이 있는 건 0건.
--   · title_en = title 인 화보가 2,502건, 다른 건 35건뿐이다.
--   따라서 이 22건은 화면에 나가는 글자를 한 글자도 바꾸지 않았다.
--   읽는 쪽 폴백이 이미 전부 깔려 있기 때문이다:
--     api/_lib/seoRenderer.js        record.title_en || titleKo
--     api/_lib/relatedI18n.js        비면 ko 원제를 그대로 둔다
--     api/_lib/seoTranslateBackfill  e.title_en || e.title
--     api/_lib/editorialFaqBackfill  e.title_en || undefined
--   즉 "폴백이 없어서" 생긴 사고가 아니다. 폴백이 정상 작동했다.
--
-- [그럼 왜 고치나] 값이 비는 자리가 쓰기 쪽에 네 군데나 있어서다.
--   api/editorials/index.js            title_en: title_en || null
--   api/submissions/[id]/review.js     title_en 을 아예 안 넣는다
--   api/admin/legacy-import-json.js    안 넣는다
--   api/cron/legacy-import.js          안 넣는다
-- "규칙이 두 벌이면 한쪽만 고쳐진다." 여기는 네 벌이다. 네 곳을 각각
-- 고치면 다섯 번째 쓰기 경로가 생기는 날 같은 구멍이 다시 난다.
-- 그래서 규칙을 코드가 아니라 DB 한 곳에 둔다.
--
-- [왜 articles 에는 안 거나] articles.title 은 한국어다. 같은 트리거를
-- 걸면 한국어 제목이 title_en 으로 복사되어 영문판에 한글이 나간다.
-- 이 트리거는 "title 이 이미 영문"인 editorials 에서만 안전하다.
-- 실측: articles 2,818건 중 title_en 이 빈 행은 0건이라 지금 필요도 없다.

create or replace function public.editorials_fill_title_en()
returns trigger
language plpgsql
as $$
begin
  if new.title_en is null or btrim(new.title_en) = '' then
    new.title_en := nullif(btrim(new.title), '');
  end if;
  return new;
end;
$$;

comment on function public.editorials_fill_title_en() is
  '162 (2026-09-15). editorials.title_en 이 비면 title 로 채운다. 쓰기 경로가 네 군데라 규칙을 DB 한 곳에 둔다. articles 에는 절대 걸지 말 것 (title 이 한국어라 영문판에 한글이 샌다).';

drop trigger if exists editorials_fill_title_en_trg on public.editorials;

create trigger editorials_fill_title_en_trg
before insert or update of title, title_en on public.editorials
for each row
execute function public.editorials_fill_title_en();

-- 되돌리려면:
--   drop trigger if exists editorials_fill_title_en_trg on public.editorials;
--   drop function if exists public.editorials_fill_title_en();
