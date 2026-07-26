-- 095_brands_affiliate_network_rakuten.sql
-- 2026-07-26 — brands.affiliate_network 허용값에 'rakuten' 추가
--
-- 배경: AFFILIATE_SPEC v2.0(2026-05) 작성 시점의 후보 네트워크만 CHECK 에 들어가
-- 있었다 → ('awin','ltk','skimlinks','direct').
-- 그런데 실제로 PAP 가 승인받아 쓰는 첫 네트워크는 **Rakuten Advertising** 이다
-- (SID 4566622 / mytheresa.com AU/Asia-Pacific MID 43171, 8% · Sale 4%,
--  2025-08-22 승인. 라쿠텐 계정 감사 2026-07-26 에서 확인).
-- 그대로 두면 brands 에 링크를 넣는 UPDATE 가 23514 로 거부된다.
--
-- 변경 성격: CHECK 허용값 **확대(additive)**. 기존 행에 영향 없음, 데이터 손실 없음.
-- 현재 brands 의 affiliate_network 는 전부 NULL/awin/skimlinks 라 재검증도 통과한다.
--
-- 롤백:
--   ALTER TABLE public.brands DROP CONSTRAINT brands_affiliate_network_check;
--   ALTER TABLE public.brands ADD CONSTRAINT brands_affiliate_network_check
--     CHECK (affiliate_network = ANY (ARRAY['awin','ltk','skimlinks','direct']));
--   (롤백 전 affiliate_network='rakuten' 행을 먼저 정리해야 한다)

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_affiliate_network_check;

ALTER TABLE public.brands ADD CONSTRAINT brands_affiliate_network_check
  CHECK (affiliate_network = ANY (ARRAY['awin'::text, 'ltk'::text, 'skimlinks'::text, 'rakuten'::text, 'direct'::text]));
