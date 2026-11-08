-- ──────────────────────────────────────────────────────────────────────
-- 182 — 관리자가 회원에게 보낸 1:1 메일 기록 (2026-11-09)
--
-- 왜: 결제 중복 건으로 회원에게 사과 메일을 보내야 했는데 관리자 화면에 그
--     수단이 없었다. Gmail 을 따로 열어 손으로 보냈고, 그래서 **어떤 회원에게
--     뭘 보냈는지 기록이 한 줄도 남지 않았다.** 다음에 그 회원이 문의하면
--     아무도 경위를 모른다.
--
-- email_log 를 쓰지 않는 이유: 그 표는 campaign_id 가 NOT NULL 이다. 캠페인
--     발송 기록이지 1:1 응대 기록이 아니다. 억지로 끼우면 두 종류가 한 표에
--     섞여 통계가 흐려진다.
--
-- 접근: service_role 전용. RLS 를 켜고 정책은 두지 않는다(= 전면 거부).
--       그랜트도 회수한다 — 마이그레이션 181 의 교훈 그대로, 정책과 그랜트는
--       두 겹 다 닫아야 한다. 정책만 지우고 그랜트를 남기면 다음 사람이
--       정책 하나를 추가하는 순간 다시 열린다.
--
-- 실행: Supabase SQL Editor
--   https://supabase.com/dashboard/project/igcazquhkwxtqsaqpznx/sql/new
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_member_emails (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  lang        TEXT,
  sent_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status      TEXT NOT NULL,          -- sent · failed · skipped(발송금지 등)
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_member_emails_member_idx
  ON public.admin_member_emails (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_member_emails_created_idx
  ON public.admin_member_emails (created_at DESC);

ALTER TABLE public.admin_member_emails ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = 전면 거부. 서버(service_role)는 RLS 를 우회하므로 그대로 동작한다.

REVOKE ALL ON public.admin_member_emails FROM anon, authenticated;

COMMIT;

-- 확인: rls_enabled=true · policies=0 · anon_sel=false
-- SELECT c.relname, c.relrowsecurity AS rls_enabled,
--        (SELECT count(*) FROM pg_policies p
--          WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
--        has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public' AND c.relname='admin_member_emails';
