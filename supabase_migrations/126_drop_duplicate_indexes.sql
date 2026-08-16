-- 126 — 중복 인덱스 정리 (2026-08-17, Supabase 성능 어드바이저 WARN 2건)
-- 완전히 동일한 인덱스가 2벌씩 있어 쓰기마다 이중 유지비용 발생. 한 벌만 남긴다.
-- (DB 적용 완료 — 도메니코 사전 승인)
DROP INDEX IF EXISTS public.idx_celeb_watch_seen_created;
DROP INDEX IF EXISTS public.idx_seo_translations_lang;
