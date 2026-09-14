-- 160 — article_title_backfill 에 query_impressions 를 더한다 (2026-09-14)
--
-- [왜] 159 로 만든 제목 도구가 큐에 15편을 넣고도 generate_next 에서
-- "대기 중인 대상이 없습니다" 를 냈다. 코드가 select 에 query_impressions 를
-- 적었는데 표에 그 열이 없어서 PostgREST 가 에러를 냈고, data 가 null 이 되어
-- '대기 없음' 으로 읽혔다. **없는 열을 읽으면 조용히 0건이 된다.**
--
-- 오늘만 같은 모양의 사고가 두 번째다 (백필이 165번 헛돈 것도 "조용히 0건"이었다).
-- 공통점: 실패가 예외가 아니라 **빈 결과**로 나타난다. 그래서 로그가 깨끗하다.
--
-- 열을 지우는 대신 더한다. 검색어별 노출은 프롬프트에 들어가면 쓸모가 있다
-- ("이 검색어가 노출 5,057" 을 알면 모델이 무엇을 겨냥할지 안다).
alter table public.article_title_backfill
  add column if not exists query_impressions bigint[];

comment on column public.article_title_backfill.query_impressions is
  '160 (2026-09-14) — queries 와 짝을 이루는 검색어별 28일 노출. 프롬프트 근거.';
