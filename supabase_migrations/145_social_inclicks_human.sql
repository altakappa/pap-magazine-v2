-- 145 — 외부→웹 유입(social_inclicks)에도 봇 함대 필터를 건다 (2026-09-07)
--
-- [왜]
-- 주간 브리핑(2026-09-07 주)이 "웹스토리 유입 1,950건 · +4,900% · 이번 주 1위 유입원"
-- 이라고 썼고 그 위에 '다음 주의 베팅'까지 세웠다. 실측(social_inclicks, 7일):
--   src='webstory' 1,951클릭 / 고유 IP 1,950 / 경로 984 / 데스크톱 100% / referrer 전부 null
--   9/2 303 · 9/3 921 · 9/4 681 · 9/5 43 · 9/6 2 · 9/7 1
-- IP 하나가 정확히 한 번, 사흘 만에 끝. 8/1 아웃클릭 함대(127)와 같은 수법이다.
-- 아웃클릭(ig_outclicks)은 127 에서 일반 규칙으로 막았는데 인클릭은 원본을 그대로 셌다.
-- 같은 구멍을 같은 규칙으로 막는다. 표에는 user_agent 가 없으므로 (일자, src) 단위.
--
-- [규칙 1 — 봇 함대] (KST 일자, src) 에서 고유 IP 60개 이상 AND 모바일 10% 미만 → 그날 그 src 전부 제외.
--   14일 실측 검증: webstory 9/3·9/4·9/5 만 걸린다. chatgpt(모바일 49~83%)·threads(33~79%)·
--   x(IP 15~19개) 는 하나도 안 걸린다.
-- [규칙 2 — 한 IP 반복] (KST 일자, IP, src) 하루 10건까지만 센다. 127 과 동일.
--
-- 원본은 지우지 않는다. 지표는 이 뷰로만 읽는다 (channelScorecard).
-- [보안] security_invoker=on, anon/authenticated 회수, service_role 만 SELECT.
-- 실행: Supabase SQL Editor 또는 apply_migration. Idempotent.

CREATE OR REPLACE VIEW public.social_inclick_bot_days AS
 SELECT (r.clicked_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
        r.src,
        count(*)                                        AS clicks,
        count(DISTINCT r.ip_hash)                       AS unique_ips,
        count(*) FILTER (WHERE r.device_type = 'mobile') AS mobile_clicks
   FROM public.social_inclicks r
  GROUP BY 1, 2
 HAVING count(DISTINCT r.ip_hash) >= 60
    AND count(*) FILTER (WHERE r.device_type = 'mobile') * 10 < count(*);

ALTER VIEW public.social_inclick_bot_days SET (security_invoker = on);
REVOKE ALL ON public.social_inclick_bot_days FROM anon;
REVOKE ALL ON public.social_inclick_bot_days FROM authenticated;
GRANT SELECT ON public.social_inclick_bot_days TO service_role;
COMMENT ON VIEW public.social_inclick_bot_days IS
  '외부→웹 인클릭 봇 함대 자동 판정 (145). (일자, src) 가 고유IP 60+ 이고 모바일 10% 미만이면 그날 그 src 는 봇. service_role 전용.';

CREATE OR REPLACE VIEW public.social_inclicks_human AS
 WITH ranked AS (
   SELECT r.id, r.src, r.campaign, r.page, r.path, r.referrer_path, r.referrer_host,
          r.device_type, r.ip_hash, r.clicked_at,
          row_number() OVER (
            PARTITION BY (r.clicked_at AT TIME ZONE 'Asia/Seoul')::date, r.ip_hash, r.src
            ORDER BY r.clicked_at
          ) AS nth_same_ip_src
     FROM public.social_inclicks r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.social_inclick_bot_days b
       WHERE b.kst_day = (r.clicked_at AT TIME ZONE 'Asia/Seoul')::date
         AND b.src = r.src)
 )
 SELECT id, src, campaign, page, path, referrer_path, referrer_host, device_type, ip_hash, clicked_at
   FROM ranked
  WHERE nth_same_ip_src <= 10;

ALTER VIEW public.social_inclicks_human SET (security_invoker = on);
REVOKE ALL ON public.social_inclicks_human FROM anon;
REVOKE ALL ON public.social_inclicks_human FROM authenticated;
GRANT SELECT ON public.social_inclicks_human TO service_role;
COMMENT ON VIEW public.social_inclicks_human IS
  '봇 함대·한 IP 반복을 뺀 외부→웹 유입 (145, 2026-09-07). 채널 성적표는 이 뷰를 읽는다.';
