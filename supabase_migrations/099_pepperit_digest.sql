-- ============================================================
-- 099 · 페퍼릿 스레드 다이제스트 (2026-08-05, 도메니코 지시)
--
-- 코드(api/_lib/digestBuckets.js · digestCopy.js · api/cron/social-digest.js ·
-- api/_lib/threads.js)는 페퍼릿 갈래를 이미 다룰 수 있다. 그런데 DB 쪽에
-- 세 군데 제약이 남아 있어서, 이 파일을 안 돌리면 코드가 맞아도 INSERT 가
-- 통째로 거부된다. 전부 CHECK 제약을 넓히는 일이고 데이터는 안 건드린다.
--
--   ① social_digests.bucket      IN ('editorial','collection','celeb')  → 'pepperit' 추가
--   ② social_digest_items.source IN ('article','editorial')             → 'pepperit' 추가
--   ③ threads_auth.id            CHECK (id = 1)                          → id IN (1,2)
--
-- ③ 이 특히 중요하다. 071 은 threads_auth 를 "한 행짜리 표"로 못 박아 두었다
-- (`id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1)`). 컬럼 구조만 보면 계정을
-- id 로 가를 수 있을 것 같지만, 실제로는 id=2 저장이 DB 레벨에서 막힌다.
-- 이걸 풀어야 페퍼릿 스레드 OAuth(=id 2 행 생성)가 성립한다.
--
-- Supabase SQL Editor 에서 도메니코가 직접 실행. STEP 순서대로.
-- 토큰 값 자체는 이 파일에 없다 — OAuth 승인 화면이 채운다.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- STEP 1 — 다이제스트 갈래에 'pepperit' 허용
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.social_digests
  DROP CONSTRAINT IF EXISTS social_digests_bucket_chk;
ALTER TABLE public.social_digests
  ADD CONSTRAINT social_digests_bucket_chk
  CHECK (bucket IN ('editorial', 'collection', 'celeb', 'pepperit'));


-- ────────────────────────────────────────────────────────────
-- STEP 2 — 다이제스트 항목의 출처에 'pepperit' 허용
--
-- 왜 'article' 로 안 뭉치나 — 중복 방지 키가 'source:source_id' 다.
-- PAP articles 와 pepperit_articles 는 서로 다른 표이므로, 같은 'article'
-- 이름 아래 두면 두 표의 id 가 한 이름 공간에서 섞인다. 둘 다 uuid 라 실제
-- 충돌 확률은 낮지만, 중복 방지는 확률에 기대면 안 되는 자리다.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.social_digest_items
  DROP CONSTRAINT IF EXISTS social_digest_items_source_chk;
ALTER TABLE public.social_digest_items
  ADD CONSTRAINT social_digest_items_source_chk
  CHECK (source IN ('article', 'editorial', 'pepperit'));


-- ────────────────────────────────────────────────────────────
-- STEP 3 — threads_auth 를 계정 2개까지 허용 (1=PAP, 2=페퍼릿)
--
-- 071 의 `CHECK (id = 1)` 은 이름이 자동 생성돼 threads_auth_id_check 로
-- 붙어 있다. 혹시 다른 이름이면 아래 DO 블록이 id 컬럼에 걸린 CHECK 를
-- 찾아서 지운다 — 이름을 손으로 맞추다 틀리는 것보다 안전하다.
-- 상한을 2 로 두는 것은 의도다. 무제한으로 열면 오타 하나로 유령 계정 행이
-- 생기고, 그 행은 아무 크론도 안 읽어서 조용히 남는다.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'threads_auth'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%id%=%1%'
  LOOP
    EXECUTE format('ALTER TABLE public.threads_auth DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.threads_auth
  DROP CONSTRAINT IF EXISTS threads_auth_id_chk;
ALTER TABLE public.threads_auth
  ADD CONSTRAINT threads_auth_id_chk CHECK (id IN (1, 2));

COMMENT ON COLUMN public.threads_auth.id IS
  '스레드 계정 번호 — 1 = @pap_magazine, 2 = @pepperitmag (api/_lib/threads.js ACCOUNTS)';


-- ────────────────────────────────────────────────────────────
-- STEP 4 — 확인
--   · 세 제약이 새 정의로 바뀌었는지
--   · threads_auth 에 아직 id=1 한 행만 있는지 (id=2 는 OAuth 로 생긴다)
-- ────────────────────────────────────────────────────────────
SELECT con.conname, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
  AND rel.relname IN ('social_digests', 'social_digest_items', 'threads_auth')
  AND con.contype = 'c'
ORDER BY rel.relname, con.conname;

SELECT id, user_id, expires_at FROM public.threads_auth ORDER BY id;
