-- ──────────────────────────────────────────────────────────────────────
-- 185 — 제보(특종) (2026-11-12)
--
-- 도메니코 2026-11-11: "이건 기사라기 보다는 특종이나 브레이킹뉴스 셀럽등
--   화제의인물에 대해 라이브한 것을 제보하는거야. ... 저스틴비버가 한국에서
--   어떤 식당에서 밥을 먹고있는 장면을 포착했다면 그것을 영상으로 찍어서
--   우리에게 제보하는거지"
--
-- ■ 이 트랙의 본체는 글이 아니라 **미디어**다
-- 확인 안 된 단서를 받는 게 아니라, 직접 목격하고 촬영한 증거를 받는다.
-- 그래서 미디어가 없으면 제출 자체가 안 된다(API 가 400).
--
-- ■ 자동으로 기사가 되는 경로는 만들지 않는다
-- 도메니코가 제보를 보고 확인하고 **직접** 기사를 쓴다. 증거가 있어도 확인은
-- 여전히 필요하다 — 영상 속 인물이 정말 그 사람인지, 언제 찍힌 것인지,
-- 맥락이 맞는지. 이번 주 SKREEM 건처럼 틀린 내용이 실리면 당사자가 항의하고,
-- 셀럽 건은 그 비용이 훨씬 크다. 그래서 published_article_id 같은 칸도,
-- '기사로 전환' 버튼도 두지 않는다. 연결은 도메니코가 메모로 남긴다.
--
-- ■ 7일 뒤 미디어 삭제 (도메니코 2026-11-11)
-- media_purged_at 에 삭제 시각을 남긴다. 행 자체는 남긴다 — 무엇이 들어왔고
-- 어떻게 처리했는지는 기록이어야 한다. 채택(used)한 제보는 미디어를 영구
-- 저장소로 먼저 복사하고(media_archived 에 그 경로), 제보함의 원본은 다른
-- 제보와 똑같이 7일 뒤 지운다. 이 순서를 지키지 않으면 발행된 기사의 영상이
-- 7일 뒤 사라진다.
--
-- ■ 제보자 신원은 외부 비공개
-- service_role 전용. RLS 켜고 정책 없음(= 전면 거부) + 그랜트 회수.
-- 181·182·183 과 같은 두 겹.
--
-- 실행: Supabase SQL Editor
--   https://supabase.com/dashboard/project/igcazquhkwxtqsaqpznx/sql/new
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.news_tips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,            -- 로그인 필수 (도메니코: '가 - 로그인 필수')

  title         TEXT NOT NULL,            -- 한 줄 요약
  body          TEXT NOT NULL,            -- 상황 설명 (2,000자)
  happened_at   TIMESTAMPTZ,              -- 발생 시각 (제출자 입력)
  happened_at_text TEXT,                  -- 제출자가 적은 원문 (시각이 애매한 경우 그대로 남긴다)
  location      TEXT NOT NULL,            -- 발생 장소

  -- 미디어: [{ path, name, type, size }] — 비공개 버킷 news-tips 안의 경로.
  -- 공개 URL 을 쓰지 않는 이유: 제보 영상은 확인 전까지 아무도 봐선 안 된다.
  media         JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- 동의 — 셋 다 없으면 접수되지 않는다
  witnessed_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,  -- 직접 목격·촬영했다
  media_rights_consent  BOOLEAN NOT NULL DEFAULT FALSE,  -- 기사·소셜 사용 허락
  social_consent        BOOLEAN NOT NULL DEFAULT FALSE,  -- §2 소셜 필수 게재
  contactable           BOOLEAN NOT NULL DEFAULT FALSE,  -- 추가 확인 연락 가능

  -- 처리
  status        TEXT NOT NULL DEFAULT 'new',   -- new · checking · used · dropped
  admin_notes   TEXT,
  reviewed_by   UUID,
  reviewed_at   TIMESTAMPTZ,
  rewarded_at   TIMESTAMPTZ,                   -- 크레딧 + 프리미엄 1개월 처리 시각(수동)

  -- 미디어 수명
  media_archived JSONB,                        -- 채택 시 영구 저장소로 복사한 경로
  media_purged_at TIMESTAMPTZ,                 -- 제보함 원본을 지운 시각

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS news_tips_user_idx    ON public.news_tips (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS news_tips_status_idx  ON public.news_tips (status, created_at DESC);
-- 7일 퍼지 크론이 훑는 길: 아직 안 지운 것만 오래된 순으로.
CREATE INDEX IF NOT EXISTS news_tips_purge_idx   ON public.news_tips (created_at)
  WHERE media_purged_at IS NULL;

ALTER TABLE public.news_tips ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = 전면 거부. 서버(service_role)는 RLS 를 우회하므로 그대로 동작한다.

REVOKE ALL ON public.news_tips FROM anon, authenticated;

COMMIT;

-- 확인: rls_enabled=true · policies=0 · anon_sel=false · auth_ins=false
-- SELECT c.relname, c.relrowsecurity AS rls_enabled,
--        (SELECT count(*) FROM pg_policies p
--          WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
--        has_table_privilege('anon', c.oid, 'SELECT')          AS anon_sel,
--        has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_ins
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public' AND c.relname='news_tips';
