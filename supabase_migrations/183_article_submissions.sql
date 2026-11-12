-- ──────────────────────────────────────────────────────────────────────
-- 183 — 아티클 서브미션 (2026-11-12)
--
-- 도메니코 2026-11-11: "서브미션을 누르면 에디토리얼 / 아티클 / 제보 이렇게
--   세개의 메뉴를 만나야해." 그중 2단계(아티클)의 표다.
--
-- 아티클은 화보가 아니라 **긴 글**이다. 그래서 `submissions` 에 끼우지 않고
-- 별도 표로 둔다. 그 표는 룩·룩이미지맵·브랜드 크레딧을 전제로 한 검증과
-- 요금 판정(submissionType)이 코드 전반에 박혀 있어서, 글을 억지로 끼우면
-- 두 종류가 한 표에서 서로의 규칙에 걸린다.
--
-- ■ 게재료 — 무료가 기본, 홍보성이면 €790
-- 도메니코 2026-11-11: "아티클이 특정 브랜드나 아티스트에 대한 홍보글이라면
--   게재료가 790유로로 똑같이 적용." 단, 사회 현상을 다루며 여러 브랜드가
--   자연스럽게 묻어나는 글은 무료다.
--
-- 판정 시점(도메니코 결정 2026-11-12, '추천대로'): **제출은 무료로 받고,
--   심사에서 홍보성으로 분류되면 그때 €790 안내를 보낸다.** 선결제가 아니다.
--   이유는 오탐의 비용이 비대칭이기 때문이다 — 비평 글에 청구서를 먼저 보내면
--   그 필자는 다시 쓰지 않는다. 그래서 payment_status 는 'none' 으로 시작하고,
--   관리자가 fee_type='branded' 로 바꾼 뒤에야 'awaiting_authorization' 이 된다.
--
-- ■ AI 홍보성 분석 — 판정이 아니라 관리자용 의견
-- promo_ai 에 점수·근거·인용·브랜드 목록만 담는다. **AI 가 요금을 매기지 않는다.**
-- 2026-11-08 에 AI 가 캡션에 없는 사실을 지어내 19개 기사를 고친 일이 있었다.
-- AI 출력은 근거와 함께 사람에게 보여주는 데까지가 안전한 선이다.
--
-- ■ 접근
-- service_role 전용. RLS 켜고 정책 없음(= 전면 거부) + 그랜트 회수.
-- 181·182 의 교훈 그대로 두 겹 다 닫는다 — 정책만 비우고 그랜트를 남기면
-- 다음 사람이 정책 하나를 추가하는 순간 다시 열린다.
--
-- 실행: Supabase SQL Editor
--   https://supabase.com/dashboard/project/igcazquhkwxtqsaqpznx/sql/new
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.article_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,          -- auth.users.id (submissions 와 같은 규칙)

  -- 글
  title         TEXT NOT NULL,
  subtitle      TEXT,
  category      TEXT NOT NULL,          -- Fashion · Beauty · Culture · Life · Art
  topic         TEXT,                   -- 제출자가 고른 세부 분류 원본 (나중 필터 확장용)
  body_lang     TEXT NOT NULL,          -- 'ko' | 'en' (작성 언어)
  body          TEXT NOT NULL,          -- 본문 (영문 800단어 / 국문 1,600자 이상)
  word_count    INTEGER,                -- 서버가 센 값 (하한 판정 근거를 남긴다)
  sources       TEXT,                   -- 참고 출처 (인용·통계가 있으면)
  author_bio    TEXT NOT NULL,          -- 바이라인용 필자 소개
  author_name   TEXT,                   -- 바이라인 표기명
  author_instagram TEXT,
  author_website   TEXT,

  -- 이미지 (대표 1장 필수 + 본문 0~9장). 직접 업로드한 본인 폴더 URL 만.
  cover_url     TEXT NOT NULL,
  image_urls    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- 동의·자진신고
  social_consent      BOOLEAN NOT NULL DEFAULT FALSE,   -- §2 소셜 필수 게재 동의
  promo_self_declared BOOLEAN NOT NULL DEFAULT FALSE,   -- 홍보성 여부 자진신고 (최종 판정은 관리자)
  terms_agreed        BOOLEAN NOT NULL DEFAULT FALSE,

  -- 심사
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending · approved · rejected · withdrawn
  fee_type      TEXT NOT NULL DEFAULT 'free',     -- free · branded(€790) — 관리자가 판정
  admin_notes   TEXT,
  feedback      TEXT,                             -- 제출자에게 보이는 심사 의견
  reviewed_by   UUID,
  reviewed_at   TIMESTAMPTZ,

  -- AI 홍보성 분석 (관리자 참고용. 요금을 매기지 않는다)
  --   { score:0~100, reasons:[..], quotes:[..], brands:[..], model, at, ok:true }
  --   실패하면 { ok:false, error } — 분석 실패가 제출을 막지 않는다.
  promo_ai      JSONB,

  -- 결제 (에디토리얼과 같은 컬럼 이름 — paypalOrders/webhook 재사용)
  payment_status           TEXT DEFAULT 'none',   -- none · awaiting_authorization · paid · waived
  paid_amount              INTEGER,
  payment_provider         TEXT,
  paypal_order_id          TEXT,
  paypal_authorization_id  TEXT,
  authorized_at            TIMESTAMPTZ,
  authorization_expires_at TIMESTAMPTZ,
  authorization_voided_at  TIMESTAMPTZ,
  fee_notified_at          TIMESTAMPTZ,           -- €790 안내 메일을 보낸 시각

  -- 발행 (절대 규칙 4 — INSERT 는 status='draft' 로만, 발행은 도메니코가)
  published_article_id UUID REFERENCES public.articles(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS article_submissions_user_idx
  ON public.article_submissions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS article_submissions_status_idx
  ON public.article_submissions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS article_submissions_fee_idx
  ON public.article_submissions (fee_type, payment_status);

ALTER TABLE public.article_submissions ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = 전면 거부. 서버(service_role)는 RLS 를 우회하므로 그대로 동작한다.

REVOKE ALL ON public.article_submissions FROM anon, authenticated;

-- ── 기고 출처 표시 ──────────────────────────────────────────────────
-- 기고로 들어온 기사를 인스타 연동 기사와 구분해야 상세에 "기고" 를 띄울 수 있다.
-- `credits` 에 끼우는 길은 택하지 않았다 — 그 칸은 **배열**로 소비된다
-- (pap-content-article.js: det.credits.map, articles-snapshot.js: Array.isArray).
-- 객체를 넣으면 렌더러가 조용히 건너뛴다. 그래서 에디토리얼이 이미 쓰는 방식
-- (editorials.source_submission_id)과 똑같이 전용 컬럼을 둔다.
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS source_article_submission_id UUID
  REFERENCES public.article_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS articles_source_article_submission_idx
  ON public.articles (source_article_submission_id)
  WHERE source_article_submission_id IS NOT NULL;

COMMIT;

-- 확인 ① 새 표: rls_enabled=true · policies=0 · anon_sel=false · auth_ins=false
-- SELECT c.relname, c.relrowsecurity AS rls_enabled,
--        (SELECT count(*) FROM pg_policies p
--          WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
--        has_table_privilege('anon', c.oid, 'SELECT')          AS anon_sel,
--        has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_ins
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public' AND c.relname='article_submissions';
--
-- 확인 ② 기고 출처 컬럼
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='articles'
--    AND column_name='source_article_submission_id';
