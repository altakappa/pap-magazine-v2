-- 123: 네이버 초안 홈판 전환 — 제목 2종 · 주제 분류 · 썸네일 문구 (2026-08-14)
--
-- 배경(실측): 발행 213편의 성적이 나왔다.
--   · 블로그 전체 일 조회수 20~85, 게시물당 1~3회
--   · 웹 유입 0명 — utm 링크가 붙은 50편이 7일간 살아 있었는데 0
--   · 인스타 유입 하루 2.4클릭 (웹 SSR 은 하루 181클릭 = 75배)
--   · 발행량과 조회수가 무상관 — 39편 올린 8/11 최저(28), 6편 올린 8/12 최고(85)
-- "많이 올리면 유입이 는다" 가설이 반증됐다. 적게·좋게·한 주제로 전환한다.
--
-- 이 마이그레이션은 그 전환에 필요한 세 값을 담을 자리를 만든다.
--   title_feed    홈판(네이버앱 피드)용 제목. 검색용 title 과 요구가 정반대라
--                 (검색=키워드 앞배치 / 홈판=호기심) 하나로는 둘 다 못 잡는다.
--   naver_topic   네이버 글쓰기의 '주제' 드롭다운 값. 홈판·주제판 후보군에
--                 들어가는 1차 관문인데 지금까지 초안이 제안조차 안 했다.
--   thumb_caption 대표 이미지에 얹을 문구. 홈판은 썸네일이 클릭의 절반이다.
--
-- 전부 NULLABLE — 기존 268행은 NULL 로 남고 화면에서 빈 값으로 표시된다.
-- 되돌리기: 세 컬럼을 DROP 하면 끝. 기존 데이터 손실 없음.
-- 실행: Supabase SQL Editor. Idempotent: 재실행 안전.

ALTER TABLE public.naver_blog_drafts
  ADD COLUMN IF NOT EXISTS title_feed    TEXT,
  ADD COLUMN IF NOT EXISTS naver_topic   TEXT,
  ADD COLUMN IF NOT EXISTS thumb_caption TEXT;

COMMENT ON COLUMN public.naver_blog_drafts.title_feed IS
  '홈판(네이버앱 피드)용 제목 — 호기심 유발형. 검색용은 title 컬럼.';
COMMENT ON COLUMN public.naver_blog_drafts.naver_topic IS
  '네이버 블로그 주제 분류 제안값. 글쓰기 화면 드롭다운과 글자가 같아야 그대로 고를 수 있다.';
COMMENT ON COLUMN public.naver_blog_drafts.thumb_caption IS
  '대표 이미지에 얹을 15자 이내 문구.';

-- 주제별 성적을 나중에 세기 위한 인덱스. 홈판 실험의 판정(3개월 뒤 하루
-- 조회수 300)은 "어떤 주제가 먹혔나"를 주제별로 갈라 봐야 의미가 있다.
CREATE INDEX IF NOT EXISTS idx_naver_blog_drafts_topic
  ON public.naver_blog_drafts (brand, naver_topic, status);
