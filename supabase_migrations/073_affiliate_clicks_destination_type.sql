-- 073: /go 리다이렉트 폴백 개선 지원 — affiliate_clicks 확장
--   1) destination_type — 클릭이 어떤 목적지로 갔는지 기록:
--      'affiliate'(어필리에이트 링크) | 'instagram'(브랜드 공식 IG) | 'search'(검색 폴백)
--   2) ip_hash 를 nullable 로 완화 — PAP_IP_HASH_SALT 미설정 시에도 클릭을 기록.
--      salt 없으면 ip_hash=null 로 저장(IP 자체는 남기지 않아 프라이버시 안전).
--      (예전 "salt 없으면 로그 안 함" Phase 0 방침 전환 — 전환 추적 우선)
-- 실행: Supabase SQL Editor (또는 apply_migration)

ALTER TABLE public.affiliate_clicks
  ADD COLUMN IF NOT EXISTS destination_type text;

ALTER TABLE public.affiliate_clicks
  ALTER COLUMN ip_hash DROP NOT NULL;
