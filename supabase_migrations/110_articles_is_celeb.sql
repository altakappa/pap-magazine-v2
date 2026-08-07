-- 110: articles 에 셀럽 갈래 판정 저장 (2026-08-07, 도메니코 지시)
--
-- 왜 필요한가 ─────────────────────────────────────────────────────────
-- 소셜 다이제스트가 셀럽/아트를 `category` 로 갈랐다. 그런데 실재하는
-- 카테고리는 넷뿐이고(Culture·Fashion·News·Beauty) 셀럽 기사가 셋에
-- 흩어져 있다. 45일 실측:
--
--   기존 규칙(category ∈ news,celeb) → 셀럽으로 잡힌 것 54건
--   실제 셀럽 기사                    → 최소 121건 (태그 마커만으로 센 값)
--
-- 그래서 '아트 콜렉션 모음' 에 아이돌이 섞이고, '셀럽 소식 모음' 은
-- 개수가 모자랐다. 도메니코가 지적한 두 증상이 같은 원인이다.
--
-- 왜 category 를 안 고치고 새 칸을 만드나 ─────────────────────────────
-- category 는 사이트의 카테고리 페이지(/fashion, /beauty …)가 그대로 쓴다.
-- 휴닝카이 기사의 category 를 'Celeb' 으로 바꾸면 그 글이 패션 목록에서
-- 사라진다. 다이제스트 하나 고치자고 사이트 구조를 흔들 이유가 없다.
-- 갈래 판정은 갈래 판정대로 따로 둔다.
--
-- 세 값의 뜻 ─────────────────────────────────────────────────────────
--   is_celeb = true   셀럽 소식
--   is_celeb = false  셀럽 아님 (아트 콜렉션)
--   is_celeb = null   아직 판정 안 함  ← 기본값. '아님' 과 다르다.
--
-- null 을 false 와 구분하는 게 핵심이다. 태그에 마커가 없다고 셀럽이
-- 아닌 게 아니다 — 실측 반례 '페라가모 플래그십 포토콜' 은 태그가
-- [ferragamo, nana, kim hee-ae, yoon seung-ah, kim moo-yul, …] 로 전부
-- 사람 이름이라 도메인 마커가 하나도 없다. 이런 건 AI 2차 판정
-- (api/cron/celeb-classify.js) 이 맡는다. null 이 그 대기열이다.
--
-- celeb_by 는 '누가 정했나' 다. manual 이 무엇보다 우선한다 —
-- 도메니코가 손으로 고친 값을 크론이 다시 덮으면 안 된다.

alter table public.articles
  add column if not exists is_celeb boolean,
  add column if not exists celeb_by text;

comment on column public.articles.is_celeb is
  '셀럽 소식 갈래인가. null = 아직 판정 안 함(AI 2차 대기). false = 판정 결과 셀럽 아님.';
comment on column public.articles.celeb_by is
  '판정 주체: marker(태그 마커) | ai(2차 판정) | manual(사람). manual 은 크론이 덮지 않는다.';

-- 다이제스트는 "최근 N일 · 발행됨 · 셀럽 여부" 로 훑는다.
-- 판정 대기열 조회(is_celeb is null)도 같은 인덱스를 탄다.
create index if not exists idx_articles_celeb_window
  on public.articles (published_date desc, is_celeb)
  where status = 'published';
