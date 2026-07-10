-- 076: SECURITY DEFINER RPC의 anon/authenticated 실행권 회수 (A-3, 2026-07 보안 감사)
--
-- 문제: 서버 전용 함수 12개가 /rest/v1/rpc/… 로 anon 키만으로 직접 호출
--       가능했다. 특히 rl_hit는 외부 호출로 레이트리밋 버킷 오염 가능.
--
-- 조사 결과(레포 grep):
--   * 프론트(anon)가 호출하는 RPC는 related_editorials 하나뿐 — 목록에 없음 → 유지
--   * 아래 10개는 전부 트리거 함수 — 트리거 발화는 호출자의 EXECUTE 권한을
--     요구하지 않으므로(CREATE TRIGGER 시점에만 체크) 회수해도 기능 영향 없음
--   * rl_hit·increment_token_version은 서버(service_role) 전용 — service_role은
--     RLS/권한 회수와 무관하게 유지됨
--   * is_admin()은 회수하지 않는다 — RLS 정책 20여 곳에서 호출되며, 정책 내
--     함수는 쿼리하는 롤의 권한으로 실행되므로 회수 시 해당 테이블 쿼리가
--     "permission denied for function" 오류로 깨진다. (anon이 호출해도
--     auth.uid()가 NULL이라 false만 반환 — 파괴 벡터 아님)

-- 트리거 함수 10개
REVOKE EXECUTE ON FUNCTION public.bump_editorial_view_count() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_comment_count() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_application_count() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_comment_count() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_post_view_count() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_creator_on_publish() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_conversation_timestamp() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_like_count() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_mood_board_vote_count() FROM anon, authenticated;

-- 서버 전용 RPC
REVOKE EXECUTE ON FUNCTION public.rl_hit(p_key text, p_limit integer, p_window_ms integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_token_version(user_id uuid) FROM anon, authenticated;

-- ⚠️ anon/authenticated 회수만으로는 부족 — 함수 생성 시 기본으로 붙는
-- PUBLIC EXECUTE(proacl의 "=X/postgres")가 남아 있으면 여전히 호출된다.
-- (적용 후 rl_hit가 계속 실행돼서 발견 — PUBLIC까지 회수해야 실제 차단)
-- service_role은 명시 grant가 별도로 있어 영향 없음.
REVOKE EXECUTE ON FUNCTION public.bump_editorial_view_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrement_comment_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_application_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_comment_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_post_view_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_creator_on_publish() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_conversation_timestamp() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_like_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_mood_board_vote_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rl_hit(p_key text, p_limit integer, p_window_ms integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_token_version(user_id uuid) FROM PUBLIC;
