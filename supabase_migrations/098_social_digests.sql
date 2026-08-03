-- ============================================================
-- 098 · 소셜 다이제스트 (2026-08-03, 도메니코 지시)
--
-- X·스레드를 인스타 유입 장치로 쓰기 위해, 며칠에 한 번씩 그동안 올라간
-- 기사를 모아 리뷰하는 글을 올린다. 기존 건별 자동 포스트는 그대로 두고
-- 이건 그 위에 얹는다.
--
-- 표 두 개인 이유: 한 다이제스트에 여러 기사가 들어가므로, 어떤 글이 이미
-- 나갔는지는 다이제스트 단위가 아니라 기사 단위로 알아야 한다. 그 기록이
-- 없으면 크론이 한 번 밀리거나 수동 실행이 겹칠 때 같은 기사가 이틀 걸러
-- 또 올라간다.
--
-- Supabase SQL Editor 에서 도메니코가 직접 실행. STEP 순서대로.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- STEP 1 — 다이제스트 본체 (안전, 바로 실행)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_digests (
  id           BIGSERIAL PRIMARY KEY,
  bucket       TEXT NOT NULL,                    -- editorial | collection | celeb
  platform     TEXT NOT NULL,                    -- x | threads
  status       TEXT NOT NULL DEFAULT 'draft',    -- draft | posted | skipped | failed
  window_days  INT,
  item_count   INT NOT NULL DEFAULT 0,
  body         TEXT,                             -- 실제 나갈 문안 (검수 대상)
  post_id      TEXT,                             -- 게시 후 X/스레드가 준 id
  attempts     INT NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at    TIMESTAMPTZ,
  CONSTRAINT social_digests_bucket_chk
    CHECK (bucket IN ('editorial', 'collection', 'celeb')),
  CONSTRAINT social_digests_platform_chk
    CHECK (platform IN ('x', 'threads')),
  CONSTRAINT social_digests_status_chk
    CHECK (status IN ('draft', 'posted', 'skipped', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_social_digests_status
  ON public.social_digests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_digests_bucket
  ON public.social_digests(bucket, platform, created_at DESC);

ALTER TABLE public.social_digests ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role(서버 크론·관리자 API) 만 접근.


-- ────────────────────────────────────────────────────────────
-- STEP 2 — 다이제스트에 들어간 기사 기록 (중복 방지의 근거)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_digest_items (
  id         BIGSERIAL PRIMARY KEY,
  digest_id  BIGINT REFERENCES public.social_digests(id) ON DELETE CASCADE,
  bucket     TEXT NOT NULL,
  source     TEXT NOT NULL,          -- article | editorial
  source_id  TEXT NOT NULL,
  title      TEXT,
  position   INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_digest_items_source_chk
    CHECK (source IN ('article', 'editorial'))
);

-- digestBuckets.loadPostedKeys 가 정확히 이 순서로 훑는다
-- (bucket 으로 좁히고 created_at 으로 60일 자르기).
CREATE INDEX IF NOT EXISTS idx_social_digest_items_lookup
  ON public.social_digest_items(bucket, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_digest_items_source
  ON public.social_digest_items(source, source_id);
CREATE INDEX IF NOT EXISTS idx_social_digest_items_digest
  ON public.social_digest_items(digest_id);

ALTER TABLE public.social_digest_items ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- STEP 3 — 확인
-- ────────────────────────────────────────────────────────────
SELECT to_regclass('public.social_digests')      AS digests,
       to_regclass('public.social_digest_items') AS digest_items;
