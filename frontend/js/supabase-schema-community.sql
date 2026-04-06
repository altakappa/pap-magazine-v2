/**
 * PAP Magazine - Community Tables (Enhanced Schema)
 *
 * 기존 supabase-schema.sql 실행 후, 이 스크립트를 추가로 실행하세요.
 * Supabase 대시보드 > SQL Editor에서 실행
 *
 * 생성되는 테이블:
 * - community_posts: 커뮤니티 게시글 (view_count, image_url, category 추가)
 * - community_comments: 댓글 (delete 정책 추가)
 * - community_likes: 좋아요
 * - community_projects: 프로젝트/콜라보레이션
 * - community_applications: 프로젝트 지원
 * - community_checkins: 사용자 체크인
 * - community_post_views: 게시글 조회 기록
 */

-- ============================================================================
-- 1. 커뮤니티 게시글 (Community Posts)
-- ============================================================================

CREATE TABLE community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  tag VARCHAR(100),  -- discussion, question, inspiration, etc.
  category VARCHAR(50) DEFAULT 'discussion',  -- notice, free, behind, qa, equipment, jobs, portfolio
  image_url TEXT,  -- URL to post image
  view_count INTEGER DEFAULT 0,  -- number of views
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_community_posts_user ON community_posts(user_id);
CREATE INDEX idx_community_posts_tag ON community_posts(tag);
CREATE INDEX idx_community_posts_category ON community_posts(category);
CREATE INDEX idx_community_posts_created ON community_posts(created_at DESC);

ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;

-- Anonymous/public users can view posts (no auth required)
CREATE POLICY "Anyone can view posts"
  ON community_posts FOR SELECT
  USING (true);

-- 사용자는 자신의 게시글 생성 가능
CREATE POLICY "Users can create posts"
  ON community_posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 사용자는 자신의 게시글 수정 가능
CREATE POLICY "Users can update own posts"
  ON community_posts FOR UPDATE
  USING (auth.uid() = user_id);

-- 관리자는 모든 게시글 수정/삭제 가능
CREATE POLICY "Admins can manage all posts"
  ON community_posts FOR ALL
  USING (is_admin());

-- ============================================================================
-- 2. 댓글 (Comments)
-- ============================================================================

CREATE TABLE community_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_comments_post ON community_comments(post_id);
CREATE INDEX idx_comments_user ON community_comments(user_id);

ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can view comments
CREATE POLICY "Anyone can view comments"
  ON community_comments FOR SELECT
  USING (true);

CREATE POLICY "Users can create comments"
  ON community_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments"
  ON community_comments FOR DELETE
  USING (auth.uid() = user_id);

-- 댓글 추가 시 게시글의 comment_count 증가
CREATE OR REPLACE FUNCTION increment_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_comment_created
  AFTER INSERT ON community_comments
  FOR EACH ROW EXECUTE FUNCTION increment_comment_count();

-- 댓글 삭제 시 게시글의 comment_count 감소
CREATE OR REPLACE FUNCTION decrement_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE community_posts SET comment_count = comment_count - 1 WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_comment_deleted
  AFTER DELETE ON community_comments
  FOR EACH ROW EXECUTE FUNCTION decrement_comment_count();

-- ============================================================================
-- 3. 좋아요 (Likes)
-- ============================================================================

CREATE TABLE community_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, user_id)
);

CREATE INDEX idx_likes_post ON community_likes(post_id);

ALTER TABLE community_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage likes"
  ON community_likes FOR ALL
  USING (auth.uid() IS NOT NULL);

-- 좋아요 추가/삭제 시 게시글의 like_count 업데이트
CREATE OR REPLACE FUNCTION update_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET like_count = like_count - 1 WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_like_changed
  AFTER INSERT OR DELETE ON community_likes
  FOR EACH ROW EXECUTE FUNCTION update_like_count();

-- ============================================================================
-- 4. 게시글 조회 기록 (Post Views)
-- ============================================================================

CREATE TABLE community_post_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  viewer_id UUID,  -- nullable for anonymous views
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_post_views_post ON community_post_views(post_id);
CREATE INDEX idx_post_views_viewer ON community_post_views(viewer_id);
CREATE INDEX idx_post_views_timestamp ON community_post_views(viewed_at);

ALTER TABLE community_post_views ENABLE ROW LEVEL SECURITY;

-- Anyone can view view records (for analytics)
CREATE POLICY "Anyone can view post view records"
  ON community_post_views FOR SELECT
  USING (true);

-- System can insert view records
CREATE POLICY "System can record views"
  ON community_post_views FOR INSERT
  WITH CHECK (true);

-- Trigger to increment view_count when a view is recorded
CREATE OR REPLACE FUNCTION increment_post_view_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE community_posts SET view_count = view_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_post_view_recorded
  AFTER INSERT ON community_post_views
  FOR EACH ROW EXECUTE FUNCTION increment_post_view_count();

-- ============================================================================
-- 5. 체크인 (Check-ins)
-- ============================================================================

CREATE TABLE community_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  checked_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, checked_at)
);

CREATE INDEX idx_checkins_user ON community_checkins(user_id);
CREATE INDEX idx_checkins_date ON community_checkins(checked_at);

ALTER TABLE community_checkins ENABLE ROW LEVEL SECURITY;

-- Users can view their own checkins
CREATE POLICY "Users can view own checkins"
  ON community_checkins FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own checkins
CREATE POLICY "Users can create own checkins"
  ON community_checkins FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 6. 프로젝트 / 콜라보레이션 (Projects)
-- ============================================================================

CREATE TABLE community_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  roles_needed TEXT[], -- photographer, model, stylist, MUA, etc.
  location VARCHAR(255),
  deadline DATE,
  status VARCHAR(50) DEFAULT 'open', -- open, closed, completed
  application_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_projects_user ON community_projects(user_id);
CREATE INDEX idx_projects_status ON community_projects(status);
CREATE INDEX idx_projects_created ON community_projects(created_at DESC);

ALTER TABLE community_projects ENABLE ROW LEVEL SECURITY;

-- Anyone can view projects (no auth required for public browsing)
CREATE POLICY "Anyone can view projects"
  ON community_projects FOR SELECT
  USING (true);

CREATE POLICY "Users can create projects"
  ON community_projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
  ON community_projects FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 7. 프로젝트 지원 (Applications)
-- ============================================================================

CREATE TABLE community_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES community_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role VARCHAR(100) NOT NULL,
  message TEXT,
  status VARCHAR(50) DEFAULT 'pending', -- pending, accepted, rejected
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, user_id)
);

CREATE INDEX idx_applications_project ON community_applications(project_id);
CREATE INDEX idx_applications_user ON community_applications(user_id);

ALTER TABLE community_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own applications"
  ON community_applications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Project owners can view applications"
  ON community_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM community_projects
      WHERE id = community_applications.project_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create applications"
  ON community_applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 지원 시 프로젝트의 application_count 증가
CREATE OR REPLACE FUNCTION increment_application_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE community_projects SET application_count = application_count + 1 WHERE id = NEW.project_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_application_created
  AFTER INSERT ON community_applications
  FOR EACH ROW EXECUTE FUNCTION increment_application_count();
