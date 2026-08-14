-- 124: articles 에 인스타 캡션 원문 보관 — 자체 취재 판별 (2026-08-14)
--
-- 왜 필요했나. 홈판 전략의 핵심 구분은 "우리가 직접 찍었는가" 다.
-- 우리만 가진 사진은 유일하고(워터밤 현장·맨시티 성수·브랜드 런칭 나이트),
-- 통신사 재탕(앰버서더 발탁·컴백 예고)은 수천 개 중 하나다. 홈판은 클릭률로
-- 뽑으므로 이 둘은 완전히 다른 물건이다.
--
-- 그런데 DB 의 어떤 컬럼으로도 안 갈렸다. 실측(2026-08-14):
--   자체 취재(맨시티 성수·워터밤 라이즈) vs 재탕(뷔 앰버서더·그래미 CEO)
--     credits              [] / []            → 동일
--     is_celeb·celeb_by    true·marker / 동일  → 동일
--     digest_kind          celeb / celeb      → 동일
--     source_instagram_url 있음 / 있음         → 동일 (전부 우리 IG 에서 온다)
--     태그                  구분 없음          → 동일
--   source_media_type 이 VIDEO 면 현장인가 싶었으나 News 61편 중 18편이
--   VIDEO 라 우연이었다.
--
-- 유일한 신호는 인스타 캡션의 크레딧 줄이다 (도메니코의 표기 규칙):
--     🎥 PAP            → 자체 취재
--     🎥 @jamiroquaihq  → 남의 영상
--     🎥 YouTube | KATSEYE → 남의 영상
-- 캡션은 지금까지 기사 생성에만 쓰고 버려졌다. 이제 원문을 남긴다.
--
-- 이름은 editorials.instagram_caption 과 맞춘다 (규칙이 두 벌이면 한쪽만 고쳐진다).
-- 채우는 곳: api/_lib/instagramImport.js buildArticleRow()
-- 읽는 곳:   api/admin/naver-blog-draft.js isOwnCoverage()
--
-- 소급 적용 없음 — 이 시점 이후 수집분부터 채워진다. 초안 선정의 조회 창이
-- 3일(NAVER_DRAFT_LOOKBACK_DAYS)이라 3일이면 신호가 완전히 찬다. 그 사이에는
-- 자체 취재가 0건으로 보이며, 선정 로직이 전체 대상으로 폴백한다.
--
-- 실행: Supabase SQL Editor. Idempotent: 재실행 안전.
-- 되돌리기: DROP COLUMN. 다른 기능이 이 컬럼에 의존하지 않는다.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS instagram_caption TEXT;

COMMENT ON COLUMN public.articles.instagram_caption IS
  '원본 인스타그램 캡션 원문. 자체 취재 판별(🎥 PAP 크레딧)에 쓴다. editorials.instagram_caption 과 같은 이름.';
