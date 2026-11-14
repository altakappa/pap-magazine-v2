-- 190 — /go 클릭에 브라우저 Fetch Metadata 기록 (2026-11-15)
--
-- 왜: 11월 들어 리퍼러를 달고 오는 분산 크롤러가 counted 를 통과한다
-- (30일 counted 7,057건 중 3,241건이 매일 00시 UTC 폭주, 모바일 0건). 이 숫자를
-- 성장으로 읽고 수익 계획을 세웠다가 철회했다 (어필리에이트-현황.md 부록 D).
-- 사람이 링크를 눌러 이동할 때 브라우저가 붙이는 Sec-Fetch-* 를 기록해
-- 1주 뒤 기준을 정한다. 지금은 기록만 — counted 판정·기존 행은 건드리지 않는다.

ALTER TABLE public.affiliate_clicks
  ADD COLUMN IF NOT EXISTS sec_fetch_site TEXT,      -- same-origin | same-site | cross-site | none
  ADD COLUMN IF NOT EXISTS sec_fetch_mode TEXT,      -- navigate | …
  ADD COLUMN IF NOT EXISTS sec_fetch_dest TEXT,      -- document | …
  ADD COLUMN IF NOT EXISTS sec_fetch_user BOOLEAN;   -- true = 사용자가 직접 누름(?1) · null = 헤더 없음

-- 인간필터 뷰(127)에 새 열을 끝에 붙인다. CREATE OR REPLACE 는 옵션을 새 목록으로
-- 갈아끼우므로 security_invoker 를 반드시 다시 적는다 (안 적으면 조용히 풀린다).
CREATE OR REPLACE VIEW public.affiliate_clicks_human WITH (security_invoker = on) AS
 SELECT id, brand_id, editorial_id, lead_creator_id, region, referrer_path,
        device_type, ip_hash, session_id, counted, clicked_at, destination_type,
        sec_fetch_site, sec_fetch_mode, sec_fetch_dest, sec_fetch_user
 FROM public.affiliate_clicks a
 WHERE NOT EXISTS (
   SELECT 1 FROM public.ig_outclick_bot_uas b
   WHERE a.clicked_at >= b.active_from AND a.clicked_at < b.active_to
     AND a.user_agent_short = left(b.ua, char_length(a.user_agent_short)));
REVOKE ALL ON public.affiliate_clicks_human FROM anon;
REVOKE ALL ON public.affiliate_clicks_human FROM authenticated;
GRANT SELECT ON public.affiliate_clicks_human TO service_role;
