-- 081: social_inclicks — 소셜 → 웹 유입 계측 (케이팝 참여 개선, 2026-07-16)
--
-- X 자동 게시(로드맵에서 "성과 미측정"으로 중단)를 계측 가능하게 만드는 짝.
-- 트윗 링크에 utm_source 가 붙고(xPost.js), utm_source 가 달린 기사 SSR 히트를
-- 1건당 1행 기록한다. ig_outclicks(075)의 인바운드 대칭 테이블.
--
-- 집계 특성: SSR CDN 캐시(s-maxage) 때문에 절대치가 아니라 추세 지표다.
-- 쓰기는 서버(service_role) 전용 — RLS enabled + 정책 없음 = 전면 차단 의도.

CREATE TABLE IF NOT EXISTS public.social_inclicks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src           text NOT NULL,            -- x|ig|naver|kakao|newsletter|other (utm_source)
  campaign      text,                     -- utm_campaign (예: pap_auto|pepperit_auto)
  page          text NOT NULL,            -- article|pepperit|editorial ...
  path          text NOT NULL,            -- 방문 경로 (쿼리 제거)
  referrer_path text,
  device_type   text,                     -- mobile|tablet|desktop
  ip_hash       text,                     -- SHA256(ip + PAP_IP_HASH_SALT), salt 미설정 시 null
  clicked_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.social_inclicks ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = 서버 전용 (의도된 전면 차단)

CREATE INDEX IF NOT EXISTS idx_social_inclicks_clicked_at ON public.social_inclicks (clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_inclicks_src ON public.social_inclicks (src, clicked_at DESC);

COMMENT ON TABLE public.social_inclicks IS '소셜→웹 유입 로그 (utm_source 기반). 서버(service_role) 전용 쓰기 — RLS 정책 없음이 정상.';
