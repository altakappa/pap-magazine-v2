-- 075: ig_outclicks — 웹 → 인스타그램 유입 계측 (B-2)
--
-- 사이트의 모든 IG 아웃링크가 /api/ig-out 리다이렉트를 경유하며
-- 클릭 1건당 1행을 기록한다. 진성 팔로워 전환 최적화의 기초 데이터.
-- 쓰기는 서버(service_role) 전용 — RLS enabled + 정책 없음 = 전면 차단이
-- 의도된 상태다 (anon/authenticated 접근 불가).

CREATE TABLE IF NOT EXISTS public.ig_outclicks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src           text NOT NULL,            -- article|editorial|ssr|naverblog|footer|nav|funnel|other
  to_type       text NOT NULL,            -- profile|post
  target_url    text NOT NULL,            -- 정규화된 instagram.com URL (쿼리스트링 제거)
  referrer_path text,                     -- 클릭이 일어난 페이지 경로 (쿼리 제거)
  device_type   text,                     -- mobile|tablet|desktop
  ip_hash       text,                     -- SHA256(ip + PAP_IP_HASH_SALT), salt 미설정 시 null
  clicked_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ig_outclicks ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = 서버 전용 (의도된 전면 차단)

CREATE INDEX IF NOT EXISTS idx_ig_outclicks_clicked_at ON public.ig_outclicks (clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_outclicks_src ON public.ig_outclicks (src, clicked_at DESC);

COMMENT ON TABLE public.ig_outclicks IS '웹→IG 아웃클릭 로그. 서버(service_role) 전용 쓰기 — RLS 정책 없음이 정상.';
