-- ──────────────────────────────────────────────────────────────────────
-- 144 — IG 릴스/게시물 훅 코드별 성과 뷰 (2026-09-06, 도메니코 지시)
--
-- 배경: 팔로워 증가 급락 진단(볼트 45_Business/2026-09-06-IG팔로워-증가-급락-진단.md).
-- 릴스는 Graph API 가 follows 를 안 준다. 앱 인사이트 8건 실측에서 저장률(saved/reach)이
-- 팔로우/1k 와 대체로 같이 움직였으므로(설윤 3.1%→3.3 · 앤톤 1.6%→0.30 · 무대 0.4%→0.05)
-- 저장률을 대리지표로 훅 유형별로 자동 집계한다.
--
-- 사용법: 캡션 맨 아래에 훅 코드 한 개를 적는다 — `#h1` ~ `#h9`.
--   h1 저장 묶음("표정 3개 저장용")   h2 착장 정답 맞히기   h3 숨은 디테일 줌
--   h4 3초 모먼트                    h5 점수 매기기(댓글) h6 비포/애프터(아카이브)
--   h7 시리즈 고정 이름               h8 설윤형(로고+저장 세 가지) h9 PAP 미션
-- 코드는 articles.instagram_caption 에서 읽는다(발행 캡션의 원본). 코드 없으면 'none'.
--
-- 뷰 둘 다 security_invoker — service_role/관리자 조회용. anon 권한 없음(RLS 원칙 유지).
-- ──────────────────────────────────────────────────────────────────────

-- 게시물별 최신 지표 1행 + 기사 매칭 + 훅 코드
CREATE OR REPLACE VIEW public.ig_post_latest
WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (post_id)
    post_id, permalink, media_type, posted_at, captured_at, age_hours,
    reach, views, like_count, comments_count, saved, shares, follows, profile_visits
  FROM public.ig_post_metric
  ORDER BY post_id, captured_at DESC
),
matched AS (
  SELECT l.*,
    a.id            AS article_id,
    a.title         AS article_title,
    a.category      AS article_category,
    a.digest_kind   AS digest_kind,
    (a.instagram_caption ~ '(🎥|🎬|📹|📷|📸|📽)\s*PAP') AS pap_shot,
    COALESCE(substring(a.instagram_caption FROM '(?:^|\s)#h([1-9])\M'), 'none') AS hook_code
  FROM latest l
  LEFT JOIN LATERAL (
    SELECT a.id, a.title, a.category, a.digest_kind, a.instagram_caption
    FROM public.articles a
    WHERE a.source_instagram_url ILIKE '%' || split_part(l.permalink, '/', 5) || '%'
    LIMIT 1
  ) a ON TRUE
)
SELECT
  post_id, permalink, media_type, posted_at, captured_at, age_hours,
  reach, views, like_count, comments_count, saved, shares, follows, profile_visits,
  article_id, article_title, article_category, digest_kind, pap_shot, hook_code,
  CASE WHEN reach > 0 THEN round(1000.0 * COALESCE(saved,0)  / reach, 2) END AS saves_per_1k,
  CASE WHEN reach > 0 THEN round(1000.0 * COALESCE(shares,0) / reach, 2) END AS shares_per_1k,
  CASE WHEN reach > 0 AND follows IS NOT NULL THEN round(1000.0 * follows / reach, 2) END AS follows_per_1k
FROM matched;

-- 훅 코드별 집계 (최근 30일, 게시 24시간 이상 지난 것만 — 초기치 왜곡 방지)
CREATE OR REPLACE VIEW public.ig_hook_stats
WITH (security_invoker = true) AS
SELECT
  hook_code,
  media_type,
  count(*)                                   AS posts,
  sum(reach)                                 AS reach,
  round(avg(reach))                          AS avg_reach,
  round(1000.0 * sum(COALESCE(saved,0))  / NULLIF(sum(reach),0), 2) AS saves_per_1k,
  round(1000.0 * sum(COALESCE(shares,0)) / NULLIF(sum(reach),0), 2) AS shares_per_1k,
  round(1000.0 * sum(COALESCE(comments_count,0)) / NULLIF(sum(reach),0), 2) AS comments_per_1k,
  sum(follows)                               AS follows,
  round(1000.0 * sum(follows) / NULLIF(sum(reach) FILTER (WHERE follows IS NOT NULL),0), 2) AS follows_per_1k,
  min(posted_at)                             AS first_post,
  max(posted_at)                             AS last_post
FROM public.ig_post_latest
WHERE posted_at > now() - interval '30 days'
  AND age_hours >= 24
GROUP BY hook_code, media_type;

REVOKE ALL ON public.ig_post_latest FROM anon, authenticated;
REVOKE ALL ON public.ig_hook_stats  FROM anon, authenticated;
GRANT SELECT ON public.ig_post_latest TO service_role;
GRANT SELECT ON public.ig_hook_stats  TO service_role;

COMMENT ON VIEW public.ig_hook_stats IS '2026-09-06 훅 코드(#h1~#h9)별 30일 성과. 저장률=팔로우 대리지표. 볼트 45_Business/2026-09-06-IG팔로워-증가-급락-진단.md';
