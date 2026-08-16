-- 125 — 웹→IG 아웃클릭 봇 함대 소급 제거 (2026-08-16)
--
-- [사건] 2026-08-01~08-09, 데스크탑 UA 10종을 IP 1,100여 개로 돌리는 봇
-- 함대가 기사 페이지의 ig-out 링크를 훑었다. 8/5 하루 인간필터(087) 통과
-- 1,171건 중 모바일 10건(0.9%) — 실측으로 봇 확정. 함대가 떠나자 주간
-- 비교가 -65% "급락"으로 표시됐다 (실제 인간 클릭은 정상).
--
-- [설계] UA 는 흔한 크롬/엣지 문자열이라 영구 차단하면 진짜 데스크탑
-- 독자까지 지운다. 그래서 (UA, 활동기간) 쌍으로만 제외한다 — 소급 제거
-- 전용. 다음 함대가 오면 이 표에 행만 추가하면 된다 (뷰 DDL 불변).
--
-- [보안] 088 의 교훈 그대로: 새 테이블은 RLS 켜고 정책 없음(service_role
-- 전용), 뷰 재생성 후 security_invoker=on 과 권한 회수를 반드시 재적용.

CREATE TABLE IF NOT EXISTS public.ig_outclick_bot_uas (
  ua text NOT NULL,
  active_from timestamptz NOT NULL,
  active_to timestamptz NOT NULL,
  note text,
  PRIMARY KEY (ua, active_from)
);
ALTER TABLE public.ig_outclick_bot_uas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ig_outclick_bot_uas FROM anon;
REVOKE ALL ON public.ig_outclick_bot_uas FROM authenticated;
GRANT SELECT ON public.ig_outclick_bot_uas TO service_role;

INSERT INTO public.ig_outclick_bot_uas (ua, active_from, active_to, note) VALUES
 ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36','2026-08-01','2026-08-10','2026-08 봇 함대'),
 ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36','2026-08-01','2026-08-10','2026-08 봇 함대')
ON CONFLICT (ua, active_from) DO NOTHING;

CREATE OR REPLACE VIEW public.ig_outclicks_human AS
 SELECT id, src, to_type, target_url, referrer_path, device_type, ip_hash, clicked_at
 FROM public.ig_outclicks r
 WHERE (clicked_at >= '2026-07-20 02:11:00+00'::timestamptz OR src <> 'ssr')
   AND NOT (src = 'ssr' AND device_type = 'desktop')
   AND NOT EXISTS (
     SELECT 1 FROM public.ig_outclick_bot_uas b
     WHERE r.user_agent = b.ua
       AND r.clicked_at >= b.active_from AND r.clicked_at < b.active_to);

-- 088 재적용 (CREATE OR REPLACE 가 옵션·권한을 보존한다고 가정하지 않는다)
ALTER VIEW public.ig_outclicks_human SET (security_invoker = on);
REVOKE ALL ON public.ig_outclicks_human FROM anon;
REVOKE ALL ON public.ig_outclicks_human FROM authenticated;
GRANT SELECT ON public.ig_outclicks_human TO service_role;

COMMENT ON VIEW public.ig_outclicks_human IS
  '크롤러 오염을 제거한 웹→IG 아웃클릭 (087 + 125 봇함대 기간제외). '
  'security_invoker=on + service_role 전용 (088).';
