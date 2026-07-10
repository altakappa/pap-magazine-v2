-- 074: comments/ratings RLS 잠금 (2026-07 보안 감사 A-2)
--
-- 문제: "Anyone can delete/update" 정책(qual=true)이 anon 키만으로
--       전체 댓글·별점 삭제/조작을 허용 (데이터 파괴 벡터).
-- 배경: 프론트는 Supabase Auth 세션 없이 anon 키로 접속(auth.uid() 없음,
--       자체 PAP JWT 사용)하므로 RLS로 "본인만" 검증이 불가능하다.
--       쓰기 경로를 /api/social/* (PAP JWT 검증 + service_role)로 이전했다.
--
-- 조치:
--  1) DELETE/UPDATE 개방 정책 제거 → anon은 삭제·조작 불가
--     (서버는 service_role이라 RLS 미적용 → 기능 유지)
--  2) INSERT는 유지하되 WITH CHECK로 길이·형식 제약 (구버전 캐시된
--     프론트가 배포 전까지 별점 등록·댓글 작성을 계속 쓸 수 있게 함.
--     신버전 프론트는 서버 경유로만 쓴다.)
--  3) SELECT 개방은 유지 (공개 데이터).

-- ── comments ──
DROP POLICY IF EXISTS "Anyone can delete comments" ON public.comments;
DROP POLICY IF EXISTS "Anyone can insert comments" ON public.comments;

CREATE POLICY "Insert comments with sane bounds" ON public.comments
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(coalesce(text, '')) BETWEEN 1 AND 2000
    AND char_length(coalesce(target_id, '')) BETWEEN 1 AND 300
    AND target_type IN ('editorial', 'article', 'film', 'short')
    AND char_length(coalesce(user_id, '')) BETWEEN 1 AND 120
    AND char_length(coalesce(user_name, '')) <= 80
    AND char_length(coalesce(user_handle, '')) <= 80
  );

-- ── ratings ──
DROP POLICY IF EXISTS "Anyone can delete ratings" ON public.ratings;
DROP POLICY IF EXISTS "Anyone can update ratings" ON public.ratings;
DROP POLICY IF EXISTS "Anyone can insert ratings" ON public.ratings;

CREATE POLICY "Insert ratings with sane bounds" ON public.ratings
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    score BETWEEN 1 AND 5
    AND char_length(coalesce(editorial_title, '')) BETWEEN 1 AND 300
    AND char_length(coalesce(user_id, '')) BETWEEN 1 AND 120
  );
