-- ──────────────────────────────────────────────────────────────────────
-- 184 — 아티클 게재료 주문의 이중청구를 **스키마 수준**에서 막는다 (2026-11-12)
--
-- 왜: 2026-08-07 에 lia.line 회원이 2분 간격 중복 결제로 €17.98 을 냈다.
--     그 뒤 `submissions.paypal_order_id` 에 부분 UNIQUE 인덱스를 걸어,
--     애플리케이션 검사를 통과해도 DB 가 거부하게 만들었다:
--       idx_submissions_paypal_order — UNIQUE (paypal_order_id) WHERE NOT NULL
--
--     애플리케이션 검사만으로는 경합을 못 막는다 — 두 요청이 "아직 미결제" 를
--     동시에 읽고 둘 다 캡처로 넘어갈 수 있다. 아티클도 같은 돈이 걸린 경로이므로
--     같은 보호를 둔다.
--
-- paypal_authorization_id 도 함께 거는 이유: 아티클은 지금 CAPTURE 로만 결제하지만
--     (심사 후 결제라 묶을 이유가 없다 — api/article-submissions/paypal-order.js 주석),
--     컬럼이 이미 있고 나중에 AUTHORIZE 경로가 생기면 그때는 이 인덱스가 없는 쪽이
--     사고가 된다. 지금 거는 비용은 0 이다.
--
-- 실행: Supabase SQL Editor
--   https://supabase.com/dashboard/project/igcazquhkwxtqsaqpznx/sql/new
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_submissions_paypal_order
  ON public.article_submissions (paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_submissions_paypal_authorization
  ON public.article_submissions (paypal_authorization_id)
  WHERE paypal_authorization_id IS NOT NULL;

COMMIT;

-- 확인: 두 인덱스가 UNIQUE + 부분(WHERE NOT NULL) 이어야 한다
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE schemaname='public' AND tablename='article_submissions'
--    AND indexdef ILIKE '%paypal%';
