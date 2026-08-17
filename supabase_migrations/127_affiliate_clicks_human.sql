-- 127 — affiliate_clicks 인간필터 뷰 (2026-08-17) · DB 적용 완료 (도메니코 승인)
-- 8/1~8/9 봇 함대가 어필리에이트 클릭도 오염 (창 기간 2,135건 중 1,496건 봇 UA
-- 일치, 모바일 3%). ig_outclick_bot_uas 를 공용 봇 UA 기간제외 테이블로 사용.
-- user_agent_short 는 원본 UA 의 접두 → prefix 일치 매칭.
CREATE OR REPLACE VIEW public.affiliate_clicks_human AS
 SELECT id, brand_id, editorial_id, lead_creator_id, region, referrer_path,
        device_type, ip_hash, session_id, counted, clicked_at, destination_type
 FROM public.affiliate_clicks a
 WHERE NOT EXISTS (
   SELECT 1 FROM public.ig_outclick_bot_uas b
   WHERE a.clicked_at >= b.active_from AND a.clicked_at < b.active_to
     AND a.user_agent_short = left(b.ua, char_length(a.user_agent_short)));
ALTER VIEW public.affiliate_clicks_human SET (security_invoker = on);
REVOKE ALL ON public.affiliate_clicks_human FROM anon;
REVOKE ALL ON public.affiliate_clicks_human FROM authenticated;
GRANT SELECT ON public.affiliate_clicks_human TO service_role;
COMMENT ON VIEW public.affiliate_clicks_human IS
  '봇 함대 오염을 제거한 어필리에이트 클릭 (127). 지표·리포트는 이 뷰를 쓴다. security_invoker=on + service_role 전용.';
