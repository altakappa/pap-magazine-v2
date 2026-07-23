-- ============================================================
-- 094 · anon 노출 테이블 7개 RLS 잠금 (2026-07-23, 하나)
-- 적용: 2026-07-23 apply_migration 으로 라이브 DB 반영 완료.
-- 근거: security advisor ERROR(rls_disabled_in_public) 7건.
-- 원리: 정책 없이 RLS on = anon/authenticated 전면 차단, service_role 우회.
--       데이터 변경 없음(DROP/DELETE 아님). 되돌리기: DISABLE ROW LEVEL SECURITY.
-- 결과: ERROR 7건 → INFO(rls_enabled_no_policy, 의도된 Pattern C)로 전환 확인.
-- ============================================================
ALTER TABLE public._backup_magazine_issues_20260721            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_magazine_issues_20260721b           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_editorial_credits_20260721          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_editorials_asiatopia_draft_20260722 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_editorials_orphan_drafts_20260722   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_editorials_creatures_cover_20260722 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_migration_failures                    ENABLE ROW LEVEL SECURITY;
