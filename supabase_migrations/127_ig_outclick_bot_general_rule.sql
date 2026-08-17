-- 127 — 웹→IG 아웃클릭 봇 필터를 '기간 한정 목록'에서 '일반 규칙'으로 (2026-08-17)
--
-- [왜 또 손대나]
-- 125 는 2026-08-01~08-10 함대의 UA 10종을 **기간 한정**으로 제외했다. 그 설계는
-- 옳았지만 방어가 아니라 청소였다. 8/11 이후 새 함대가 오자 그대로 통과했다.
--
-- 2026-08-17 실측 (최근 7일 ig_outclicks_human):
--   src='ssr_article'  312클릭 / 고유IP 310 / 모바일 4%
--     └ UA 2종(맥 Chrome 148·146)이 267건. IP 가 클릭 수와 1:1.
--       "UA 소수 + IP 다수" — 8월 초 함대와 정확히 같은 수법.
--   src='pepperit-spa' 160 / 고유IP **1**, src='pepperit-footer' 159 / 고유IP **1**
--     └ 같은 기기(Android Edge 151) 하나가 21시간에 315회. 봇은 아니다.
--       페이지에 자동 새로고침 코드가 없으니 브라우저 프리로드·탭 방치로 추정.
--
-- 즉 오염이 두 종류다. 하나는 **많은 IP + 적은 UA**(봇 함대), 다른 하나는
-- **한 IP 의 반복 발사**(프리로드·중복). 규칙도 두 개여야 한다.
--
-- [규칙 1 — 봇 함대] (일자, UA) 단위로 판정한다.
--   고유 IP 60개 이상  AND  모바일 비율 10% 미만  → 그 날 그 UA 는 전부 제외.
--   근거: 진짜 독자는 한 UA 문자열을 60개 IP 로 나눠 쓰지 않는다. 그리고 우리
--   독자는 모바일이 절반 이상이다(7일 실측 51~65%). 두 조건을 동시에 만족하는
--   날은 사람일 수 없다. 하루 단위라 함대가 오면 그날부터 자동으로 빠지고,
--   떠나면 자동으로 복귀한다 — 사람이 목록을 관리하지 않아도 된다.
--
--   ※ 기존 125 의 수동 목록(ig_outclick_bot_uas)은 그대로 둔다. 일반 규칙이
--     놓치는 소규모 함대를 손으로 잡는 용도로 계속 쓴다. 두 겹이 낫다.
--
-- [규칙 2 — 한 IP 의 반복] (일자, IP, src) 단위로 하루 10건까지만 센다.
--   초과분은 지표에서 뺀다. 원본은 그대로 남는다.
--   근거: 같은 사람이 같은 자리에서 인스타 링크를 하루 10번 넘게 누를 일은
--   없다. 프리로드·자동 재시도·탭 방치가 만든 숫자다.
--   10 을 고른 이유: pepperit 사례가 158건이었고, 정상적인 최대치(여러 기사를
--   돌며 누르는 열성 독자)는 관측상 한 자릿수였다. 여유를 두고 10.
--
-- [보안] 088·125 와 동일: security_invoker=on, anon/authenticated 권한 회수,
--   service_role 만 SELECT. CREATE OR REPLACE 가 옵션을 보존한다고 가정하지 않고
--   매번 재적용한다.
--
-- 실행: Supabase SQL Editor. Idempotent: 재실행 안전 (뷰 재생성뿐).

-- ── 규칙 1 판정 뷰: 어느 날 어느 UA 가 봇이었나 ────────────────────────
CREATE OR REPLACE VIEW public.ig_outclick_bot_days AS
 SELECT (r.clicked_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
        r.user_agent,
        count(*)                                              AS clicks,
        count(DISTINCT r.ip_hash)                             AS unique_ips,
        count(*) FILTER (WHERE r.device_type = 'mobile')       AS mobile_clicks
   FROM public.ig_outclicks r
  WHERE r.user_agent IS NOT NULL
  GROUP BY 1, 2
 HAVING count(DISTINCT r.ip_hash) >= 60
    AND count(*) FILTER (WHERE r.device_type = 'mobile') * 10 < count(*);

ALTER VIEW public.ig_outclick_bot_days SET (security_invoker = on);
REVOKE ALL ON public.ig_outclick_bot_days FROM anon;
REVOKE ALL ON public.ig_outclick_bot_days FROM authenticated;
GRANT SELECT ON public.ig_outclick_bot_days TO service_role;

COMMENT ON VIEW public.ig_outclick_bot_days IS
  '봇 함대 자동 판정 (127). (일자, UA) 가 고유IP 60+ 이고 모바일 10% 미만이면 그날 그 UA 는 봇. '
  '목록 관리 없이 자동으로 붙었다 떨어진다. service_role 전용.';

-- ── 인간 필터 본체 ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ig_outclicks_human AS
 WITH ranked AS (
   SELECT r.id, r.src, r.to_type, r.target_url, r.referrer_path,
          r.device_type, r.ip_hash, r.clicked_at,
          /* 규칙 2 — 같은 (날짜, IP, src) 안에서 몇 번째 클릭인가 */
          row_number() OVER (
            PARTITION BY (r.clicked_at AT TIME ZONE 'Asia/Seoul')::date, r.ip_hash, r.src
            ORDER BY r.clicked_at
          ) AS nth_same_ip_src
     FROM public.ig_outclicks r
    WHERE (r.clicked_at >= '2026-07-20 02:11:00+00'::timestamptz OR r.src <> 'ssr')
      AND NOT (r.src = 'ssr' AND r.device_type = 'desktop')
      /* 125 — 손으로 등록한 함대 (기간 한정) */
      AND NOT EXISTS (
        SELECT 1 FROM public.ig_outclick_bot_uas b
         WHERE r.user_agent = b.ua
           AND r.clicked_at >= b.active_from AND r.clicked_at < b.active_to)
      /* 127 규칙 1 — 자동 판정된 봇 함대 (일자 단위) */
      AND NOT EXISTS (
        SELECT 1 FROM public.ig_outclick_bot_days d
         WHERE d.user_agent = r.user_agent
           AND d.kst_day = (r.clicked_at AT TIME ZONE 'Asia/Seoul')::date)
 )
 SELECT id, src, to_type, target_url, referrer_path, device_type, ip_hash, clicked_at
   FROM ranked
  /* 127 규칙 2 — 한 IP 가 같은 자리에서 하루 10건까지만 */
  WHERE nth_same_ip_src <= 10;

-- 088 재적용 (CREATE OR REPLACE 가 옵션·권한을 보존한다고 가정하지 않는다)
ALTER VIEW public.ig_outclicks_human SET (security_invoker = on);
REVOKE ALL ON public.ig_outclicks_human FROM anon;
REVOKE ALL ON public.ig_outclicks_human FROM authenticated;
GRANT SELECT ON public.ig_outclicks_human TO service_role;

COMMENT ON VIEW public.ig_outclicks_human IS
  '크롤러·중복 오염을 제거한 웹→IG 아웃클릭. '
  '087(ssr 데스크탑) + 125(수동 함대 목록) + 127(자동 함대 판정 + IP당 하루 10건 상한). '
  'security_invoker=on + service_role 전용 (088).';
