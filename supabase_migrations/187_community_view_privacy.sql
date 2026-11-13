-- ──────────────────────────────────────────────────────────────────────
-- 187 — 커뮤니티 열람 기록을 비공개로 (2026-11-13)
--
-- ■ 무엇이 열려 있었나
-- `community_post_views` 는 post_id · viewer_id · viewed_at 을 담는다. 즉
-- **누가 어떤 글을 언제 봤는지**다. 그런데 이 표에는
--   정책: "Anyone can view post view records"  USING (true)
--   그랜트: anon 에 SELECT 있음
-- 둘이 겹쳐서, 공개 anon 키만 있으면 모든 회원의 커뮤니티 열람 기록을 통째로
-- 읽을 수 있었다. 실측으로 확인했다(set role anon → select 가 통과).
--
-- 2026-11-07 감사는 이 표의 **쓰기** 구멍을 잡았다(누구나 조회수를 조작할 수
-- 있었다 → 서버 엔드포인트로 옮기고 그랜트 회수). 읽기 쪽은 그때 보지 못했다.
-- 쓰기와 읽기를 따로 보면 이렇게 한쪽이 남는다.
--
-- ■ 지금은 0행이다. 그래서 지금 고친다
-- 뷰 기록을 서버 엔드포인트(api/community/posts/[id]/view.js)로 옮긴 뒤 표가
-- 비어 있다. 커뮤니티에 사람이 들어오면 쌓이기 시작하고, 그때는 이미 유출된
-- 뒤다. 비어 있는 동안 닫는 것이 가장 싸다.
--
-- ■ 어떻게 닫나
-- 조회수 **집계**는 공개여도 된다(글마다 몇 번 읽혔는지). 공개돼선 안 되는 것은
-- **누가** 읽었는지다. 그 집계는 community_posts.view_count 가 이미 들고 있고
-- 서버가 갱신한다. 그래서 이 표 자체는 아무에게도 보여줄 필요가 없다 —
-- 정책을 지우고(= 전면 거부) 그랜트도 회수한다. 181·182·183·185 와 같은 두 겹.
--
-- ■ 181 의 남은 DROP POLICY 5줄도 여기서 함께 처리한다
-- 그 다섯 정책은 그랜트가 회수된 상태라 지금은 작동하지 않는 껍데기다. 다만
-- 다음 사람이 정책 하나를 추가하는 순간 다시 열린다 — 껍데기를 남겨 두면
-- "정책이 있으니 의도된 것" 으로 읽힌다. 같은 자리에서 지운다.
--
-- 실행: Supabase SQL Editor
--   https://supabase.com/dashboard/project/igcazquhkwxtqsaqpznx/sql/new
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) 커뮤니티 열람 기록: 전면 비공개 ────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view post view records" ON public.community_post_views;
REVOKE ALL ON public.community_post_views FROM anon, authenticated;

-- ── 2) 181 의 남은 껍데기 정책 5개 ────────────────────────────────────
-- (그랜트는 181 에서 이미 회수됨 — 이건 두 번째 겹이다)
DROP POLICY IF EXISTS "anon_insert_click"               ON public.affiliate_clicks;
DROP POLICY IF EXISTS "System can award badges"         ON public.community_badges;
DROP POLICY IF EXISTS "System can create notifications" ON public.community_notifications;
DROP POLICY IF EXISTS "System can record views"         ON public.community_post_views;
DROP POLICY IF EXISTS "anon_insert_view"                ON public.editorial_views;

COMMIT;

-- 확인 ① 열람 기록: policies=0 · anon_sel=false
-- SELECT c.relname, c.relrowsecurity AS rls,
--        (SELECT count(*) FROM pg_policies p
--          WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
--        has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public' AND c.relname='community_post_views';
--
-- 확인 ② 181 의 다섯 정책이 사라졌다
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname='public' AND policyname IN
--   ('anon_insert_click','System can award badges','System can create notifications',
--    'System can record views','anon_insert_view');
