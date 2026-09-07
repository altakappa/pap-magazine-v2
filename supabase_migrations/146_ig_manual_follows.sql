-- 146 — 릴스 팔로우 수동 기록 + ig_post_latest 에 병합 (2026-09-07)
--
-- [왜]
-- 인스타 API 는 릴스(VIDEO)에 follows/profile_visits 를 주지 않는다. 그런데 앱 인사이트
-- "팔로우 기준 인기 콘텐츠"는 준다(9/7 실측: 설윤 +74 · 창빈 +25 · HEY PAP +18 · 변우석 +17,
-- 전부 릴스). 팔로워를 만드는 형식이 정확히 릴스인데 장부에는 0 으로 찍혀 왔다.
-- 도메니코가 텔레그램에 "팔로우 <숏코드|링크> <숫자>" 한 줄을 보내면 여기 저장하고,
-- ig_post_latest.follows 는 API 값이 없을 때만 이 값을 쓴다(캐러셀 API 값이 우선).
--
-- [보안] RLS on, anon/authenticated 권한 없음. service_role 만.
-- 실행: apply_migration. Idempotent.

CREATE TABLE IF NOT EXISTS public.ig_manual_follows (
  post_id     text PRIMARY KEY,
  permalink   text,
  follows     integer NOT NULL CHECK (follows >= 0),
  source      text NOT NULL DEFAULT 'app',
  recorded_by text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ig_manual_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ig_manual_follows FROM anon, authenticated;
GRANT ALL ON public.ig_manual_follows TO service_role;
COMMENT ON TABLE public.ig_manual_follows IS
  '앱 인사이트에서 사람이 읽어 적은 게시물별 팔로우 수 (146). API 가 안 주는 릴스용. ig_post_latest 가 COALESCE 로 흡수.';

-- 뷰 재정의: 열 이름·순서·타입은 144 와 동일, follows 만 COALESCE(API, 수동)
CREATE OR REPLACE VIEW public.ig_post_latest
WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (post_id)
    post_id, permalink, media_type, posted_at, captured_at, age_hours,
    reach, views, like_count, comments_count, saved, shares, follows, profile_visits
  FROM public.ig_post_metric
  ORDER BY post_id, captured_at DESC
),
merged AS (
  SELECT l.post_id, l.permalink, l.media_type, l.posted_at, l.captured_at, l.age_hours,
         l.reach, l.views, l.like_count, l.comments_count, l.saved, l.shares,
         COALESCE(l.follows, mf.follows) AS follows,
         l.profile_visits
  FROM latest l
  LEFT JOIN public.ig_manual_follows mf ON mf.post_id = l.post_id
),
matched AS (
  SELECT l.*,
    a.id            AS article_id,
    a.title         AS article_title,
    a.category      AS article_category,
    a.digest_kind   AS digest_kind,
    (a.instagram_caption ~ '(🎥|🎬|📹|📷|📸|📽)\s*PAP') AS pap_shot,
    COALESCE(substring(a.instagram_caption FROM '(?:^|\s)#h([1-9])\M'), 'none') AS hook_code
  FROM merged l
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

REVOKE ALL ON public.ig_post_latest FROM anon, authenticated;
GRANT SELECT ON public.ig_post_latest TO service_role;
