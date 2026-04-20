/**
 * PAP Magazine - Community V2 Schema Extension
 *
 * 기존 supabase-schema-community.sql 실행 후, 이 스크립트를 추가 실행하세요.
 *
 * 추가 테이블:
 * - community_reports: 신고
 * - community_follows: 팔로우/팔로잉
 * - community_notifications: 알림
 * - community_messages: DM (다이렉트 메시지)
 * - community_conversations: DM 대화방
 * - community_badges: 크리에이터 뱃지/레벨
 * - community_mood_boards: 인스피레이션 보드
 * - community_mood_board_items: 무드보드 아이템
 * - community_mood_board_votes: 무드보드 투표
 *
 * 추가 컬럼:
 * - community_posts.pinned: 고정 게시글
 */

-- ============================================================================
-- 0. 기존 테이블 컬럼 추가
-- ============================================================================

-- 게시글 고정 기능
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_community_posts_pinned ON community_posts(pinned) WHERE pinned = true;

-- 지원 상태 업데이트 타임스탬프
ALTER TABLE community_applications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- 관리자가 지원 상태 변경 가능
CREATE POLICY IF NOT EXISTS "Project owners can update applications"
  ON community_applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM community_projects
      WHERE id = community_applications.project_id AND user_id = auth.uid()
    )
  );

-- ============================================================================
-- 8. 신고 (Reports)
-- ============================================================================

CREATE TABLE community_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  admin_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(reporter_id, target_type, target_id)
);

CREATE INDEX idx_reports_status ON community_reports(status);
CREATE INDEX idx_reports_target ON community_reports(target_type, target_id);

ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create reports"
  ON community_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users can view own reports"
  ON community_reports FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "Admins can manage reports"
  ON community_reports FOR ALL
  USING (is_admin());

-- ============================================================================
-- 9. 팔로우 (Follows)
-- ============================================================================

CREATE TABLE community_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

CREATE INDEX idx_follows_follower ON community_follows(follower_id);
CREATE INDEX idx_follows_following ON community_follows(following_id);

ALTER TABLE community_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view follows"
  ON community_follows FOR SELECT
  USING (true);

CREATE POLICY "Users can follow"
  ON community_follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
  ON community_follows FOR DELETE
  USING (auth.uid() = follower_id);

-- ============================================================================
-- 10. 알림 (Notifications)
-- ============================================================================

CREATE TABLE community_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'like', 'comment', 'follow', 'project_apply', 'project_accepted', 'project_rejected', 'mention', 'dm'
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  target_type VARCHAR(20), -- 'post', 'comment', 'project', 'message'
  target_id UUID,
  message TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user ON community_notifications(user_id);
CREATE INDEX idx_notifications_read ON community_notifications(user_id, read) WHERE read = false;
CREATE INDEX idx_notifications_created ON community_notifications(created_at DESC);

ALTER TABLE community_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON community_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON community_notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "System can create notifications"
  ON community_notifications FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- 11. DM 대화방 (Conversations)
-- ============================================================================

CREATE TABLE community_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_1 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  participant_2 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(participant_1, participant_2),
  CHECK (participant_1 < participant_2) -- ensure consistent ordering
);

CREATE INDEX idx_conversations_p1 ON community_conversations(participant_1);
CREATE INDEX idx_conversations_p2 ON community_conversations(participant_2);
CREATE INDEX idx_conversations_last_msg ON community_conversations(last_message_at DESC);

ALTER TABLE community_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view conversations"
  ON community_conversations FOR SELECT
  USING (auth.uid() = participant_1 OR auth.uid() = participant_2);

CREATE POLICY "Users can create conversations"
  ON community_conversations FOR INSERT
  WITH CHECK (auth.uid() = participant_1 OR auth.uid() = participant_2);

-- ============================================================================
-- 12. DM 메시지 (Messages)
-- ============================================================================

CREATE TABLE community_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES community_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_conversation ON community_messages(conversation_id);
CREATE INDEX idx_messages_sender ON community_messages(sender_id);
CREATE INDEX idx_messages_created ON community_messages(created_at DESC);

ALTER TABLE community_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Conversation participants can view messages"
  ON community_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM community_conversations c
      WHERE c.id = community_messages.conversation_id
        AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
    )
  );

CREATE POLICY "Users can send messages"
  ON community_messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- Update conversation last_message_at when new message sent
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE community_conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_sent
  AFTER INSERT ON community_messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_timestamp();

-- ============================================================================
-- 13. 크리에이터 뱃지/레벨 (Badges)
-- ============================================================================

CREATE TABLE community_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_type VARCHAR(50) NOT NULL, -- 'level', 'achievement', 'special'
  badge_name VARCHAR(100) NOT NULL, -- 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'first_post', 'collab_10', etc.
  badge_data JSONB DEFAULT '{}', -- flexible data (icon, color, description, etc.)
  awarded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, badge_name)
);

CREATE INDEX idx_badges_user ON community_badges(user_id);
CREATE INDEX idx_badges_type ON community_badges(badge_type);

ALTER TABLE community_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view badges"
  ON community_badges FOR SELECT
  USING (true);

CREATE POLICY "System can award badges"
  ON community_badges FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- 14. 인스피레이션 무드보드 (Mood Boards)
-- ============================================================================

CREATE TABLE community_mood_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  description TEXT,
  tags TEXT[],
  vote_count INTEGER DEFAULT 0,
  visibility VARCHAR(20) DEFAULT 'public', -- 'public', 'followers', 'private'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mood_boards_user ON community_mood_boards(user_id);
CREATE INDEX idx_mood_boards_votes ON community_mood_boards(vote_count DESC);

ALTER TABLE community_mood_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view public mood boards"
  ON community_mood_boards FOR SELECT
  USING (visibility = 'public' OR user_id = auth.uid());

CREATE POLICY "Users can create mood boards"
  ON community_mood_boards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mood boards"
  ON community_mood_boards FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TABLE community_mood_board_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES community_mood_boards(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  position_x FLOAT DEFAULT 0,
  position_y FLOAT DEFAULT 0,
  width FLOAT DEFAULT 200,
  height FLOAT DEFAULT 200,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mood_items_board ON community_mood_board_items(board_id);

ALTER TABLE community_mood_board_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mood board items follow board visibility"
  ON community_mood_board_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM community_mood_boards b
      WHERE b.id = community_mood_board_items.board_id
        AND (b.visibility = 'public' OR b.user_id = auth.uid())
    )
  );

CREATE POLICY "Board owners can manage items"
  ON community_mood_board_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM community_mood_boards b
      WHERE b.id = community_mood_board_items.board_id AND b.user_id = auth.uid()
    )
  );

CREATE TABLE community_mood_board_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES community_mood_boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(board_id, user_id)
);

ALTER TABLE community_mood_board_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage votes"
  ON community_mood_board_votes FOR ALL
  USING (auth.uid() IS NOT NULL);

-- Vote count trigger
CREATE OR REPLACE FUNCTION update_mood_board_vote_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_mood_boards SET vote_count = vote_count + 1 WHERE id = NEW.board_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_mood_boards SET vote_count = vote_count - 1 WHERE id = OLD.board_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_mood_vote_changed
  AFTER INSERT OR DELETE ON community_mood_board_votes
  FOR EACH ROW EXECUTE FUNCTION update_mood_board_vote_count();
