-- ──────────────────────────────────────────────────────────────────────
-- 147 — IG 게시물 "형태" 라벨 + 화보 매칭 (2026-09-08, 도메니코 지시 "d를 붙여봅시다")
--
-- 배경 ───────────────────────────────────────────────────────────────
-- 45_Business/2026-09-06-IG팔로워-증가-급락-진단.md 이 두 가지를 남겼다.
--   ① "잘 되는 기사(0.6~1.85/1k)와 안 되는 기사(0~0.08/1k)가 20배 갈리는데
--      지금 비율은 실측 필요" — 즉 **셀 수가 없다.**
--   ② 훅 코드(#h1~#h9, 마이그레이션 144)로 재보려 했다.
--
-- 9/8 실측: ig_post_latest 394행 전부 hook_code='none'. **한 건도 안 붙었다.**
-- 이유는 분명하다. 훅 코드는 사람이 인스타 앱에서 캡션에 직접 타이핑해야 한다.
-- 기사는 인스타에서 사이트로 **가져오는** 방향이라(instagramImport), 코드를 넣을
-- 자리가 발행 화면이 아니라 인스타 캡션이다. 열흘에 한 번도 안 눌리는 버튼은
-- 계측 장치가 아니다. 그래서 **사람 손을 빼고** 사후 자동 분류로 바꾼다.
--
-- 두 번째 구멍: 화보가 안 보인다 ─────────────────────────────────────
-- ig_post_latest 는 articles 에만 조인한다. 화보는 editorials 테이블이라
-- 매칭이 통째로 없다. 실측: 기사 매칭 없는 31행 중 **26행이 editorials 와 매칭**된다
-- (The Routine · Ornamental Behaviour · AFTER · REVERIE …). 나머지 5행은 진짜 미매칭.
-- 화보는 9/6 문서 기준 팔로우 전환 1.06/1k 로 전 유형 1위인데, 우리 표에서는
-- '기사 매칭 없음' 이라는 이름으로 5행의 잡음과 섞여 있었다.
-- igContentMix(9/7)가 `!article_id → 화보` 로 추정하던 자리를 **사실**로 바꾼다.
--
-- 형태(post_form) 는 무엇인가 ────────────────────────────────────────
--   'editorial'  화보. editorials 매칭이면 자동 — AI 안 부른다.
--   'visual'     이미지가 주인공. 작가·크리에이터·재료·기법이 주어인 발견형.
--                (귀여운 얼굴 62만 · 손으로 그린 마스크 15만 · 머리카락 조각 4.7만)
--   'namenews'   이름이 주인공. 셀럽·브랜드 소식, 발탁·컴백·근황.
--                (제니 롤라팔루자 도달 25만인데 팔로우 0.05/1k)
--   'onsite'     현장. 행사·팝업·전시·포토콜 취재기.
--                (페라가모 FW26 2.4k · 프리즈 서울 3.8k · 잠실 런웨이 4.8k)
--   'none'       셋 다 아님.
--
-- digest_kind(celeb/collection)와 **다른 축**이다. digest_kind 는 '누구 이야기냐',
-- post_form 은 '어떤 모양이냐' 를 묻는다. 셀럽이면서 visual 인 글이 있고
-- (설윤 저장하는 세 가지 방법), collection 이면서 onsite 인 글이 있다(프리즈 서울).
-- 두 축을 곱해야 편성이 나온다. 그래서 열을 합치지 않고 따로 둔다.
--
-- 마커를 안 만든 이유 ───────────────────────────────────────────────
-- digestKind.js 는 태그 마커가 1차를 본다. 여기서는 **일부러 안 만들었다.**
-- 9/8 실측: 컬렉션 게시물의 태그를 히트(도달 2만+) 여부로 갈라 보니 표본이
-- 태그당 4~21건뿐이고 적중률이 0~80% 로 흩어졌다(sculpture 5건 중 4건 vs
-- fashion art 6건 중 0건). 이 정도 신호로 규칙을 만들면 라벨이 틀린 채로
-- 쌓인다. **틀린 계측기는 없는 계측기보다 나쁘다.** 그래서 AI 판정만 쓴다.
-- 대신 digest_kind 와 달리 post_form 은 아무것도 막지 않는다(다이제스트는
-- 이 값을 안 읽는다) — 즉시 답이 없어도 되므로 마커가 필요 없다.
--
-- 비용 ───────────────────────────────────────────────────────────────
-- 새 크론을 만들지 않는다. tests/vercel-cost-guard 실측 2,598 / 예산 2,600 —
-- 남은 여유가 2회다. 대신 celeb-classify(하루 144회)에 얹는다. 그 크론의
-- 대기열은 지금 **0건**이다(published 2,592건 전부 digest_kind 채워짐).
-- 10분마다 돌면서 아무것도 안 하던 자리에 이 일을 넣는다. 추가 호출 0.
-- ──────────────────────────────────────────────────────────────────────

alter table public.articles
  add column if not exists post_form text,
  add column if not exists post_form_by text;

alter table public.articles drop constraint if exists articles_post_form_chk;
alter table public.articles add constraint articles_post_form_chk
  check (post_form is null or post_form in ('visual', 'namenews', 'onsite', 'none'));

comment on column public.articles.post_form is
  '게시물 형태: visual(이미지가 주인공) | namenews(이름이 주인공) | onsite(현장 취재) | none. null = 판정 대기. digest_kind 와 다른 축이다.';
comment on column public.articles.post_form_by is
  '판정 주체: ai | manual. manual 은 크론이 덮지 않는다.';

-- 대기열 조회용. IG 에 올라간 기사만 판정한다(계측 대상이 그것뿐).
create index if not exists idx_articles_post_form_queue
  on public.articles (published_date desc)
  where status = 'published' and source_instagram_url is not null and post_form is null;

-- ── 뷰 재정의: 화보(editorials) 조인 + 형태 열 ────────────────────────
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
    a.id AS a_id, a.title AS a_title, a.category AS a_category,
    a.digest_kind AS a_digest_kind, a.instagram_caption AS a_caption,
    a.post_form AS a_post_form,
    e.id AS e_id, e.title AS e_title
  FROM merged l
  LEFT JOIN LATERAL (
    SELECT a.id, a.title, a.category, a.digest_kind, a.instagram_caption, a.post_form
    FROM public.articles a
    WHERE a.source_instagram_url ILIKE '%' || split_part(l.permalink, '/', 5) || '%'
    LIMIT 1
  ) a ON TRUE
  LEFT JOIN LATERAL (
    SELECT e.id, e.title
    FROM public.editorials e
    WHERE e.source_instagram_url ILIKE '%' || split_part(l.permalink, '/', 5) || '%'
    LIMIT 1
  ) e ON TRUE
)
SELECT
  post_id, permalink, media_type, posted_at, captured_at, age_hours,
  reach, views, like_count, comments_count, saved, shares, follows, profile_visits,
  a_id AS article_id,
  COALESCE(a_title, e_title)          AS article_title,
  a_category                          AS article_category,
  a_digest_kind                       AS digest_kind,
  (a_caption ~ '(🎥|🎬|📹|📷|📸|📽)\s*PAP') AS pap_shot,
  COALESCE(substring(a_caption FROM '(?:^|\s)#h([1-9])\M'), 'none') AS hook_code,
  -- 화보인지 기사인지 미매칭인지. 추정이 아니라 조인 결과다.
  -- 화보가 기사보다 먼저다. 실측 9/8: 451행 중 화보 매칭 35 · 기사 매칭 411 · 미매칭 5.
  -- 둘 다 매칭되는 9행이 있는데(같은 숏코드가 양쪽에 적힌 경우) 그건 화보로 친다 —
  -- 화보는 우리가 찍은 원본이고 기사는 그 파생이다.
  CASE WHEN e_id IS NOT NULL THEN 'editorial'
       WHEN a_id IS NOT NULL THEN 'article'
       ELSE 'unmatched' END           AS content_kind,
  e_id                                AS editorial_id,
  -- 화보는 자동으로 'editorial'. 기사는 AI 판정값. 미매칭은 null.
  CASE WHEN e_id IS NOT NULL THEN 'editorial' ELSE a_post_form END AS post_form,
  CASE WHEN reach > 0 THEN round(1000.0 * COALESCE(saved,0)  / reach, 2) END AS saves_per_1k,
  CASE WHEN reach > 0 THEN round(1000.0 * COALESCE(shares,0) / reach, 2) END AS shares_per_1k,
  CASE WHEN reach > 0 AND follows IS NOT NULL THEN round(1000.0 * follows / reach, 2) END AS follows_per_1k
FROM matched;

-- 형태별 30일 집계. 훅 코드 뷰(144)와 같은 모양 — 읽는 사람이 새로 배울 게 없게.
CREATE OR REPLACE VIEW public.ig_form_stats
WITH (security_invoker = true) AS
SELECT
  COALESCE(post_form, '(미판정)')            AS post_form,
  media_type,
  count(*)                                   AS posts,
  sum(reach)                                 AS reach,
  round(avg(reach))                          AS avg_reach,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY reach) AS med_reach,
  count(*) FILTER (WHERE reach >= 50000)     AS hits_50k,
  count(*) FILTER (WHERE reach < 5000)       AS under_5k,
  round(1000.0 * sum(COALESCE(saved,0))  / NULLIF(sum(reach),0), 2) AS saves_per_1k,
  round(1000.0 * sum(COALESCE(shares,0)) / NULLIF(sum(reach),0), 2) AS shares_per_1k,
  round(1000.0 * sum(COALESCE(like_count,0)) / NULLIF(sum(reach),0), 2) AS likes_per_1k,
  sum(follows)                               AS follows,
  round(1000.0 * sum(follows) / NULLIF(sum(reach) FILTER (WHERE follows IS NOT NULL),0), 2) AS follows_per_1k,
  min(posted_at)                             AS first_post,
  max(posted_at)                             AS last_post
FROM public.ig_post_latest
WHERE posted_at > now() - interval '30 days'
  AND age_hours >= 24
GROUP BY 1, 2;

REVOKE ALL ON public.ig_post_latest FROM anon, authenticated;
REVOKE ALL ON public.ig_form_stats  FROM anon, authenticated;
GRANT SELECT ON public.ig_post_latest TO service_role;
GRANT SELECT ON public.ig_form_stats  TO service_role;

COMMENT ON VIEW public.ig_form_stats IS
  '2026-09-08 형태(visual/namenews/onsite/editorial)별 30일 성과. 훅 코드(144)가 0건 붙은 것을 대체. 볼트 45_Business/2026-09-06-IG팔로워-증가-급락-진단.md';
