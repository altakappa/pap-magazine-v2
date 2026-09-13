-- 151 — 아웃클릭 봇 필터 규칙 3: SSR 링크는 referrer 없는 비모바일 클릭을 세지 않는다
--        (2026-09-13, 자동 브리핑이 "ssr_article +986% 급증"을 성과로 보고한 사건)
--
-- [사건] 2026-09-12 브리핑이 오늘의 1순위로 "ssr_article 아웃클릭 219→818(+274%)
-- 급증 원인 파악, 고성과 기사 발굴"을 올렸다. 실측하니 사람이 아니었다.
--
--   9/11 ssr_article 하루치: 946건이 referrer_path=NULL · 모바일 0% ·
--   고유 IP 257 · 09:16~02:35 균일 분포. 진짜 사람 클릭은 8건(ja·zh 기사, 모바일 100%).
--
-- [왜 127 이 못 잡았나] 127 규칙 1은 (일자, UA) 가 고유 IP 60개 이상 AND
-- 모바일 10% 미만일 때 봇으로 본다. 9/13 실측에서 큰 UA 다섯은 정확히 잡힌다
-- (838/148IP · 634/131 · 542/105 · 165/60 · 149/60). 그런데 **꼬리가 샌다**:
--
--   70클릭/44IP · 68/42 · 64/40 · 45/32  ← 전부 모바일 0%, referrer 전부 NULL
--
-- 함대가 UA 를 여러 개로 쪼개 각 UA 의 IP 를 60개 아래로 유지하면 규칙을 피한다.
-- 규칙 2(한 IP 하루 10건)도 무력하다 — 44개 IP 로 70클릭이면 IP 당 1.6건이다.
-- 임계값을 낮추면(60→30) 진짜 독자가 많은 날을 오판할 위험이 커진다.
-- **임계값 경쟁 대신 봇이 흉내 낼 수 없는 신호를 쓴다.**
--
-- [규칙 3] src 가 'ssr%' 이고 referrer_path IS NULL 이고 모바일이 아니면 제외.
--
--   근거 ①: ssr_article · ssr_top · ssr 링크는 **SSR 페이지 HTML 안에만** 있다
--   (seoRenderer.js). 사람이 그 페이지에서 링크를 누르면 같은 출처 요청이라
--   브라우저가 Referer 를 반드시 보낸다. referrer 가 비어 있다는 것은 그 링크를
--   페이지에서 누른 게 아니라 URL 을 직접 때렸다는 뜻이다.
--
--   근거 ② (14일 실측, src like 'ssr%'):
--       referrer 없음  7,907건 · 모바일  2~4%
--       referrer 있음    228건 · 모바일 54~65%
--     완전히 다른 두 집단이고, 모바일 54~65% 가 우리 독자의 지문이다.
--
--   모바일은 살려 둔다: 일부 모바일 브라우저·인앱 뷰가 Referer 를 지운다.
--   비모바일만 제외하면 그 위험이 사라진다.
--
-- [안전 검사 — 봇이 적던 과거에 이 규칙을 적용하면 사람이 날아가나]
--   주(src like 'ssr%')   현재 human → 규칙3 적용   그 주 모바일 비율
--   2026-07-20                506 →  500 (-1%)            98%
--   2026-07-27                190 →  172 (-9%)            86%
--   2026-08-03                 90 →   49 (-46%)           53%
--   2026-08-10                 87 →   33 (-62%)           32%
--   모바일 비율이 높은(사람이 많은) 주는 거의 안 깎이고, 모바일이 무너지는
--   (봇이 섞이는) 주부터 깎인다. 규칙이 의도대로 작동한다는 증거다.
--
-- [적용 후 예상 — 14일]
--   ssr_article 1,981 → 167 · ssr_top 1,018 → 224 · ssr 68 → 61 · ssr_niche 42 → 18
--   x · spa_top · article · editorial_mid · nav · footer 등 **다른 src 는 한 건도 안 변한다.**
--
-- [기존 규칙 보존] 087 의 ssr 시작 시각 조건, 125 의 수동 UA 목록, 127 의
-- 자동 함대 판정과 IP 당 10건 상한을 전부 그대로 둔다. 규칙 3은 그 위에 얹는다.
-- 컬럼 이름·순서·개수도 그대로다 (CREATE OR REPLACE VIEW 제약, 147 교훈).
--
-- 실행: Supabase SQL Editor. Idempotent: 재실행 안전 (뷰 재생성뿐).

CREATE OR REPLACE VIEW public.ig_outclicks_human AS
 WITH ranked AS (
         SELECT r.id,
            r.src,
            r.to_type,
            r.target_url,
            r.referrer_path,
            r.device_type,
            r.ip_hash,
            r.clicked_at,
            row_number() OVER (PARTITION BY ((r.clicked_at AT TIME ZONE 'Asia/Seoul'::text)::date), r.ip_hash, r.src ORDER BY r.clicked_at) AS nth_same_ip_src
           FROM ig_outclicks r
          WHERE (r.clicked_at >= '2026-07-20 02:11:00+00'::timestamp with time zone OR r.src <> 'ssr'::text)
            AND NOT (r.src = 'ssr'::text AND r.device_type = 'desktop'::text)
            -- ── 규칙 3 (151) — SSR 링크인데 referrer 가 없고 모바일도 아니면 봇 ──
            AND NOT (r.src LIKE 'ssr%'::text
                     AND r.referrer_path IS NULL
                     AND r.device_type IS DISTINCT FROM 'mobile'::text)
            AND NOT (EXISTS ( SELECT 1
                   FROM ig_outclick_bot_uas b
                  WHERE r.user_agent = b.ua AND r.clicked_at >= b.active_from AND r.clicked_at < b.active_to))
            AND NOT (EXISTS ( SELECT 1
                   FROM ig_outclick_bot_days d
                  WHERE d.user_agent = r.user_agent AND d.kst_day = (r.clicked_at AT TIME ZONE 'Asia/Seoul'::text)::date))
        )
 SELECT id,
    src,
    to_type,
    target_url,
    referrer_path,
    device_type,
    ip_hash,
    clicked_at
   FROM ranked
  WHERE nth_same_ip_src <= 10;

-- 088·125·127 과 동일한 보안을 매번 재적용한다 (REPLACE 가 보존한다고 가정하지 않는다).
ALTER VIEW public.ig_outclicks_human SET (security_invoker = on);
REVOKE ALL ON public.ig_outclicks_human FROM anon;
REVOKE ALL ON public.ig_outclicks_human FROM authenticated;
GRANT SELECT ON public.ig_outclicks_human TO service_role;

COMMENT ON VIEW public.ig_outclicks_human IS
  '아웃클릭 인간필터. 087 시작시각 · 125 수동 UA 목록 · 127 자동 함대 판정 + IP당 10건 상한 · '
  '151 SSR 링크의 referrer 없는 비모바일 클릭 제외. 지표는 항상 이 뷰를 읽는다(원본 ig_outclicks 금지).';
