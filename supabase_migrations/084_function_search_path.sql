-- 084 — 보안 하드닝: 전 함수 search_path 고정 (Supabase security advisor 0011)
-- 근거: search_path 미고정 함수는 악의적 스키마 셰도잉(같은 이름의 함수/테이블을
-- 다른 스키마에 만들어 가로채기)에 노출될 수 있다. 동작 변화 없는 순수 하드닝.
-- 실행: Supabase SQL Editor (도메니코). 2026-07-17 감사에서 도출.

ALTER FUNCTION public.bump_editorial_view_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.decrement_comment_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_application_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_comment_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_post_view_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_token_version(user_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.match_editorials_by_embedding(query_embedding vector, match_count integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.promote_creator_on_publish() SET search_path = public, pg_temp;
ALTER FUNCTION public.related_editorials(target_id uuid, match_count integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.trending_editorials(period_hours integer, max_items integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.trigger_set_timestamp() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_conversation_timestamp() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_like_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_mood_board_vote_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;
