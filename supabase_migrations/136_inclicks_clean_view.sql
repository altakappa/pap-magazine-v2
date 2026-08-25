-- 136 — social_inclicks_clean 뷰를 저장소에 되찾아오고 자기 호스트 판정을 넓힌다
--
-- 배경 ─────────────────────────────────────────────────────────────────
-- 이 뷰는 DB 에만 있었고 supabase_migrations/ 에는 파일이 없었다. 즉 저장소를
-- 아무리 읽어도 집계 규칙을 알 수 없는 상태였다. 먼저 그 드리프트를 없앤다.
--
-- 고치는 것 두 가지
--  ① is_internal 이 'www.pap-magazine.com' 하나만 봤다. apex(pap-magazine.com)
--     와 papkorea 계열, 프리뷰 배포(*.vercel.app)를 놓친다. 애플리케이션 쪽
--     차단 목록(api/_lib/socialInclick.js SELF_HOSTS)과 범위를 맞춘다.
--  ② referrer_group 에서 'internal' 판정도 같은 기준을 쓴다.
--
-- 주의 ─────────────────────────────────────────────────────────────────
-- 2026-08-25 이전 63건의 자기 리퍼러 행은 **지우지 않는다.** 그중 58건은
-- 랜딩 비콘이 남긴 진짜 유입이고(그때는 바깥 리퍼러를 실어 보내지 않았다),
-- 5건만 내부 이동 오염이다. 지금 기준으로 소급해 지우면 8/19~8/25 의 인스타
-- 바이오 링크 성적이 통째로 사라진다. 뷰가 표시만 하고 판단은 사람이 한다.

CREATE OR REPLACE VIEW public.social_inclicks_clean AS
SELECT
  id,
  clicked_at,
  ip_hash,
  device_type,
  page,
  path,
  campaign,
  src AS src_raw,
  CASE
    WHEN src = ANY (ARRAY['chatgpt','chatgpt_com','openai']) THEN 'chatgpt'
    WHEN src = ANY (ARRAY['claude','claude_ai']) THEN 'claude'
    ELSE src
  END AS src_norm,
  referrer_host,
  referrer_path,
  CASE
    WHEN referrer_host IS NULL THEN 'unknown'
    WHEN referrer_host IN ('www.pap-magazine.com','pap-magazine.com','www.papkorea.com','papkorea.com')
      OR referrer_host ~ '(^|\.)pap-magazine[a-z0-9-]*\.vercel\.app$' THEN 'internal'
    WHEN referrer_host LIKE '%facebook.com' THEN 'facebook'
    WHEN referrer_host = 't.co' OR referrer_host LIKE '%twitter.com' OR referrer_host LIKE '%x.com' THEN 'x'
    WHEN referrer_host LIKE '%instagram.com' THEN 'instagram'
    WHEN referrer_host LIKE '%threads.%' THEN 'threads'
    WHEN referrer_host = 'chatgpt.com' OR referrer_host LIKE '%openai.com' THEN 'chatgpt'
    WHEN referrer_host = 'gemini.google.com' THEN 'gemini'
    WHEN referrer_host LIKE '%perplexity.ai' THEN 'perplexity'
    WHEN referrer_host LIKE '%claude.ai' THEN 'claude'
    WHEN referrer_host LIKE '%bing.com' OR referrer_host LIKE '%copilot%' THEN 'copilot'
    WHEN referrer_host LIKE '%google.%' THEN 'google'
    WHEN referrer_host LIKE '%naver.%' THEN 'naver'
    WHEN referrer_host LIKE '%youtube.%' OR referrer_host = 'youtu.be' THEN 'youtube'
    WHEN referrer_host LIKE '%pinterest.%' THEN 'pinterest'
    WHEN referrer_host LIKE '%kakao%' THEN 'kakao'
    ELSE 'other'
  END AS referrer_group,
  (referrer_host IN ('www.pap-magazine.com','pap-magazine.com','www.papkorea.com','papkorea.com')
   OR referrer_host ~ '(^|\.)pap-magazine[a-z0-9-]*\.vercel\.app$') AS is_internal,
  (campaign IS NOT NULL) AS is_tagged_link
FROM public.social_inclicks;
