-- 125: 상위 노출 기사 본문 보강 큐 (2026-08-17)
--
-- 배경 (GSC 30일 실측): 노출의 89.6%가 4~10위에 갇혀 있고 그 구간 CTR 은 1.27%.
-- 원인은 콘텐츠 두께였다. 발행 2,371편 본문 평균 545자, 72.5%가 600자 미만.
-- 커밋 016fecf 로 신규 기사는 800~1,200자로 올렸지만 기존 기사는 그대로다.
-- 이 표는 그중 **노출이 실제로 나오는 상위 31편만** 골라 담는 작업 큐다.
--
-- 왜 생성과 적용을 나누나: 이건 신규 발행이 아니라 이미 색인된 본문을 바꾸는
-- 일이다. 자동으로 덮어쓰면 되돌릴 수 없고, 저장소 규칙상 발행 판단은 사람 몫이다.
-- old_body 에 적용 직전 원본을 통째로 보관하므로 언제든 되돌릴 수 있다.
--
-- 소비자: api/admin/article-body-backfill.js
-- 실행: Supabase SQL Editor. Idempotent: 재실행 안전.

CREATE TABLE IF NOT EXISTS public.article_body_backfill (
  article_id   UUID PRIMARY KEY REFERENCES public.articles(id) ON DELETE CASCADE,
  impressions  INTEGER NOT NULL DEFAULT 0,
  old_body     TEXT,
  new_body     TEXT,
  old_len      INTEGER,
  new_len      INTEGER,
  status       TEXT NOT NULL DEFAULT 'queued',
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_at TIMESTAMPTZ,
  applied_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_article_body_backfill_queue
  ON public.article_body_backfill (status, impressions DESC);

ALTER TABLE public.article_body_backfill ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.article_body_backfill IS
  '상위 노출 기사 본문 보강 큐. 이미 색인된 본문을 바꾸는 작업이라 생성과 적용을 분리한다. service_role 전용(RLS).';
COMMENT ON COLUMN public.article_body_backfill.status IS
  'queued(대상 선정됨) | draft(초안 생성됨, 검토 대기) | applied(articles.content 에 반영) | rejected(반려) | failed(생성 실패)';
COMMENT ON COLUMN public.article_body_backfill.old_body IS
  '적용 직전의 articles.content 원본. 되돌리기용이라 절대 지우지 않는다.';
