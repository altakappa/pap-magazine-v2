-- 111: 다이제스트 갈래를 두 갈래에서 **세 갈래**로 (2026-08-07, 도메니코 지시)
--
-- 110 이 몇 시간 전에 만든 is_celeb(boolean) 을 대체한다.
--
-- 왜 바로 갈아엎나 ────────────────────────────────────────────────────
-- 도메니코: "폭염은 아트도 셀럽도 아니야. 애매한건 억지로 포함시키지 말고
--            그냥 빼줘."
--
-- boolean 은 '셀럽이다 / 셀럽이 아니다' 만 말할 수 있다. 그러면 '서울 전역에
-- 내려진 폭염중대경보' 같은 기사가 **셀럽이 아니라는 이유만으로** 아트
-- 콜렉션에 실린다. 두 갈래만 있으면 남는 것을 버릴 자리가 없다.
--
-- 그래서 답을 셋으로 만든다:
--   'celeb'       셀럽 소식 모음
--   'collection'  아트 콜렉션 모음
--   'none'        두 모음 모두에서 뺀다
--   null          아직 판정 안 함 (AI 2차 대기)
--
-- 'none' 이 얼마나 드문지 ─────────────────────────────────────────────
-- 45일 332건 실측에서 마커가 none 이라 답한 기사는 **1건**(폭염경보)뿐이다.
-- 넓게 훑어 애매한 것을 무더기로 버리는 규칙이 아니라, 정말 해당 없는 것만
-- 빼는 규칙이라는 뜻이다.
--
-- 110 의 두 칸은 지우지 않는다 ────────────────────────────────────────
-- is_celeb / celeb_by 는 값을 옮긴 뒤 그대로 둔다. 지우는 건 도메니코가
-- 직접 판단할 일이고(운영 규칙), 남아 있어도 코드가 안 읽으니 해가 없다.
-- 다만 헷갈리지 않게 comment 로 '쓰지 말 것' 을 못박아 둔다.
-- 정리하고 싶어지면:
--   alter table public.articles drop column is_celeb, drop column celeb_by;

alter table public.articles
  add column if not exists digest_kind text,
  add column if not exists kind_by text;

-- 110 에서 마커로 확정해 둔 셀럽 판정을 그대로 옮긴다 (454건).
update public.articles
set digest_kind = 'celeb',
    kind_by = coalesce(celeb_by, 'marker')
where is_celeb is true and digest_kind is null;

alter table public.articles
  drop constraint if exists articles_digest_kind_chk;
alter table public.articles
  add constraint articles_digest_kind_chk
  check (digest_kind is null or digest_kind in ('celeb', 'collection', 'none'));

comment on column public.articles.digest_kind is
  '소셜 다이제스트 갈래: celeb | collection | none(두 모음 모두에서 뺀다). null = 판정 대기.';
comment on column public.articles.kind_by is
  '판정 주체: marker(태그) | ai(2차 판정) | manual(사람). manual 은 크론이 덮지 않는다.';
comment on column public.articles.is_celeb is
  '[폐기됨 2026-08-07] digest_kind 로 대체. 읽지 말 것.';
comment on column public.articles.celeb_by is
  '[폐기됨 2026-08-07] kind_by 로 대체. 읽지 말 것.';

drop index if exists idx_articles_celeb_window;
create index if not exists idx_articles_digest_kind_window
  on public.articles (published_date desc, digest_kind)
  where status = 'published';
