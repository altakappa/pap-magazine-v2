/**
 * PAP Magazine — Mood board comments
 * Step 15 in supabase_migrations/README.md execution order.
 *
 * Adds a lightweight comment thread on each community mood board so members
 * can react with text ("이 라이팅 좋다", "어디서 찍었어요?") on top of the
 * existing ♥ vote primitive. Single-level (no nested replies) for v1 —
 * keep it simple to match the playground philosophy.
 *
 * Separate table from `community_comments` (which is post-specific with
 * post_id NOT NULL) to avoid making that schema polymorphic.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + DO blocks for policies.
 */

CREATE TABLE IF NOT EXISTS community_mood_board_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mood_board_id UUID NOT NULL REFERENCES community_mood_boards(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id)              ON DELETE CASCADE,
  content       TEXT NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mood_board_comments_board
  ON community_mood_board_comments(mood_board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mood_board_comments_user
  ON community_mood_board_comments(user_id);

ALTER TABLE community_mood_board_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_mood_board_comments' AND policyname = 'Anyone can view mood board comments') THEN
    CREATE POLICY "Anyone can view mood board comments"
      ON community_mood_board_comments FOR SELECT
      USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_mood_board_comments' AND policyname = 'Users can post mood board comments') THEN
    CREATE POLICY "Users can post mood board comments"
      ON community_mood_board_comments FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_mood_board_comments' AND policyname = 'Users can delete own mood board comments') THEN
    CREATE POLICY "Users can delete own mood board comments"
      ON community_mood_board_comments FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
