/**
 * PAP Magazine - Supabase Database Schema
 *
 * 이 SQL 스크립트는 Supabase 프로젝트에서 실행해야 합니다.
 * Supabase 대시보드 > SQL Editor에서 복사하여 실행하세요.
 *
 * 생성되는 테이블:
 * - profiles: 사용자 프로필
 * - submissions: 편집 자료 제출
 * - pullletters: 풀레터 요청
 * - subscribers: 구독 정보
 */

-- ============================================================================
-- 1. 프로필 테이블 (Profiles Table)
-- ============================================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  avatar_url TEXT,
  role VARCHAR(50) DEFAULT 'member',  -- member, admin
  subscription_plan VARCHAR(50) DEFAULT 'free',
  subscription_status VARCHAR(50) DEFAULT 'inactive',
  bio TEXT,
  website VARCHAR(255),
  location VARCHAR(255),
  instagram VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_subscription_plan ON profiles(subscription_plan);

-- Row Level Security (RLS) 정책
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 관리자 여부 확인 함수
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 사용자는 자신의 프로필 조회 가능
CREATE POLICY "Users can view own profile"
  ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- 관리자는 모든 프로필 조회 가능
CREATE POLICY "Admins can view all profiles"
  ON profiles
  FOR SELECT
  USING (is_admin());

-- 사용자는 자신의 프로필만 수정 가능
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 관리자는 모든 프로필 수정 가능 (역할 변경 등)
CREATE POLICY "Admins can update all profiles"
  ON profiles
  FOR UPDATE
  USING (is_admin());

-- 사용자 가입 시 프로필 자동 생성
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 2. 제출 테이블 (Submissions Table)
-- ============================================================================

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  file_urls TEXT[] DEFAULT '{}',
  credits VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_submissions_user_id ON submissions(user_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_created_at ON submissions(created_at DESC);

-- Row Level Security (RLS) 정책
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 제출물만 조회 가능
CREATE POLICY "Users can view own submissions"
  ON submissions
  FOR SELECT
  USING (auth.uid() = user_id);

-- 사용자는 자신의 제출물만 생성 가능
CREATE POLICY "Users can insert own submissions"
  ON submissions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 사용자는 자신의 제출물만 수정 가능
CREATE POLICY "Users can update own submissions"
  ON submissions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 사용자는 자신의 제출물만 삭제 가능
CREATE POLICY "Users can delete own submissions"
  ON submissions
  FOR DELETE
  USING (auth.uid() = user_id);

-- 관리자는 모든 제출물 조회 가능
CREATE POLICY "Admins can view all submissions"
  ON submissions
  FOR SELECT
  USING (is_admin());

-- 관리자는 모든 제출물 수정 가능 (심사)
CREATE POLICY "Admins can update all submissions"
  ON submissions
  FOR UPDATE
  USING (is_admin());

-- ============================================================================
-- 3. 풀레터 테이블 (Pull Letters Table)
-- ============================================================================

CREATE TABLE pullletters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_text TEXT NOT NULL,
  file_urls TEXT[] DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending', -- pending, accepted, rejected
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_pullletters_user_id ON pullletters(user_id);
CREATE INDEX idx_pullletters_status ON pullletters(status);
CREATE INDEX idx_pullletters_created_at ON pullletters(created_at DESC);

-- Row Level Security (RLS) 정책
ALTER TABLE pullletters ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 풀레터만 조회 가능
CREATE POLICY "Users can view own pullletters"
  ON pullletters
  FOR SELECT
  USING (auth.uid() = user_id);

-- 사용자는 자신의 풀레터만 생성 가능
CREATE POLICY "Users can insert own pullletters"
  ON pullletters
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 사용자는 자신의 풀레터만 수정 가능
CREATE POLICY "Users can update own pullletters"
  ON pullletters
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 사용자는 자신의 풀레터만 삭제 가능
CREATE POLICY "Users can delete own pullletters"
  ON pullletters
  FOR DELETE
  USING (auth.uid() = user_id);

-- 관리자는 모든 풀레터 조회 가능
CREATE POLICY "Admins can view all pullletters"
  ON pullletters
  FOR SELECT
  USING (is_admin());

-- 관리자는 모든 풀레터 수정 가능 (심사)
CREATE POLICY "Admins can update all pullletters"
  ON pullletters
  FOR UPDATE
  USING (is_admin());

-- ============================================================================
-- 4. 구독자 테이블 (Subscribers Table)
-- ============================================================================

CREATE TABLE subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  plan VARCHAR(50) NOT NULL, -- free, standard_monthly, standard_yearly, premium_monthly, premium_yearly
  billing_cycle VARCHAR(50), -- monthly, yearly
  status VARCHAR(50) DEFAULT 'active', -- active, canceled, expired
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_subscribers_user_id ON subscribers(user_id);
CREATE INDEX idx_subscribers_stripe_customer_id ON subscribers(stripe_customer_id);
CREATE INDEX idx_subscribers_stripe_subscription_id ON subscribers(stripe_subscription_id);
CREATE INDEX idx_subscribers_plan ON subscribers(plan);
CREATE INDEX idx_subscribers_status ON subscribers(status);

-- Row Level Security (RLS) 정책
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 구독 정보만 조회 가능
CREATE POLICY "Users can view own subscription"
  ON subscribers
  FOR SELECT
  USING (auth.uid() = user_id);

-- 관리자는 모든 구독 정보 조회 가능
CREATE POLICY "Admins can view all subscriptions"
  ON subscribers
  FOR SELECT
  USING (is_admin());

-- 관리자는 구독 정보 수정 가능
CREATE POLICY "Admins can update all subscriptions"
  ON subscribers
  FOR UPDATE
  USING (is_admin());

-- 구독 정보 생성은 백엔드(서버) 또는 관리자만 가능

-- ============================================================================
-- 5. 스토리지 버킷 설정
-- ============================================================================

-- 다음 명령들은 Supabase 대시보드 또는 다른 방법으로 실행하세요:
-- (SQL에서 직접 실행 불가)

/*
-- avatars 버킷 생성
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

-- submissions 버킷 생성
INSERT INTO storage.buckets (id, name, public) VALUES ('submissions', 'submissions', false);

-- pullletters 버킷 생성
INSERT INTO storage.buckets (id, name, public) VALUES ('pullletters', 'pullletters', false);

-- 각 버킷에 대한 RLS 정책 설정
-- avatars 버킷: 공개
CREATE POLICY "Public avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

-- submissions 버킷: 자신의 파일만
CREATE POLICY "Users can upload submissions"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'submissions' AND auth.uid()::text = (storage.foldername(name))[1]);

-- pullletters 버킷: 자신의 파일만
CREATE POLICY "Users can upload pullletters"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'pullletters' AND auth.uid()::text = (storage.foldername(name))[1]);
*/

-- ============================================================================
-- 6. 헬퍼 함수 (Helper Functions)
-- ============================================================================

-- 사용자의 구독 상태 확인 함수
CREATE OR REPLACE FUNCTION get_user_subscription_status(user_id UUID)
RETURNS TABLE(plan VARCHAR, status VARCHAR, expires_at TIMESTAMP WITH TIME ZONE) AS $$
BEGIN
  RETURN QUERY
  SELECT
    subscribers.plan,
    subscribers.status,
    subscribers.current_period_end
  FROM subscribers
  WHERE subscribers.user_id = get_user_subscription_status.user_id;
END;
$$ LANGUAGE plpgsql;

-- 만료된 구독 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_expired_subscriptions()
RETURNS void AS $$
BEGIN
  UPDATE subscribers
  SET status = 'expired'
  WHERE status = 'active'
    AND current_period_end < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. 업데이트 타임스탐프 자동 설정 (Triggers)
-- ============================================================================

-- profiles 테이블
CREATE OR REPLACE FUNCTION update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_profiles_updated_at();

-- submissions 테이블
CREATE OR REPLACE FUNCTION update_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_submissions_updated_at();

-- pullletters 테이블
CREATE OR REPLACE FUNCTION update_pullletters_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pullletters_updated_at
  BEFORE UPDATE ON pullletters
  FOR EACH ROW
  EXECUTE FUNCTION update_pullletters_updated_at();

-- subscribers 테이블
CREATE OR REPLACE FUNCTION update_subscribers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscribers_updated_at
  BEFORE UPDATE ON subscribers
  FOR EACH ROW
  EXECUTE FUNCTION update_subscribers_updated_at();

-- ============================================================================
-- 8. 데이터 초기화 (Optional - 테스트용)
-- ============================================================================

/*
-- 테스트 사용자 생성 (선택사항)
INSERT INTO profiles (id, email, name, subscription_plan, subscription_status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'test@example.com',
  'Test User',
  'free',
  'inactive'
);
*/

-- ============================================================================
-- 9. 관리자 계정 설정 (Admin Setup)
-- ============================================================================

-- ⚠️ 중요: Supabase에서 관리자 계정을 만든 후, 아래 SQL로 관리자 권한 부여
-- [your-user-id] 를 Supabase Auth > Users에서 확인한 실제 UUID로 교체하세요

/*
-- 관리자 권한 부여 (contact@pap-magazine.com 계정으로 가입 후 실행)
UPDATE profiles
SET role = 'admin'
WHERE email = 'contact@pap-magazine.com';
*/

-- ============================================================================
-- 10. 관리자용 뷰 (Admin Views) — 대시보드에서 쉽게 조회
-- ============================================================================

-- 전체 회원 목록 뷰 (관리자 전용)
CREATE OR REPLACE VIEW admin_members_view AS
SELECT
  p.id,
  p.email,
  p.name,
  p.role,
  p.subscription_plan,
  p.subscription_status,
  p.location,
  p.instagram,
  p.created_at AS joined_at,
  s.plan AS stripe_plan,
  s.status AS stripe_status,
  s.current_period_end AS subscription_expires,
  (SELECT COUNT(*) FROM submissions sub WHERE sub.user_id = p.id) AS submission_count,
  (SELECT COUNT(*) FROM pullletters pl WHERE pl.user_id = p.id) AS pullletter_count
FROM profiles p
LEFT JOIN subscribers s ON s.user_id = p.id
ORDER BY p.created_at DESC;

-- 최근 제출물 뷰 (관리자 전용)
CREATE OR REPLACE VIEW admin_submissions_view AS
SELECT
  sub.id,
  sub.title,
  sub.status,
  sub.created_at,
  sub.admin_notes,
  p.name AS submitter_name,
  p.email AS submitter_email,
  p.subscription_plan
FROM submissions sub
JOIN profiles p ON p.id = sub.user_id
ORDER BY sub.created_at DESC;

-- 최근 풀레터 뷰 (관리자 전용)
CREATE OR REPLACE VIEW admin_pullletters_view AS
SELECT
  pl.id,
  pl.request_text,
  pl.status,
  pl.created_at,
  pl.admin_notes,
  p.name AS requester_name,
  p.email AS requester_email,
  p.subscription_plan
FROM pullletters pl
JOIN profiles p ON p.id = pl.user_id
ORDER BY pl.created_at DESC;

-- 구독 통계 뷰
CREATE OR REPLACE VIEW admin_subscription_stats AS
SELECT
  subscription_plan,
  COUNT(*) AS total_users,
  COUNT(*) FILTER (WHERE subscription_status = 'active') AS active_users,
  COUNT(*) FILTER (WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '30 days') AS new_last_30d
FROM profiles
GROUP BY subscription_plan;

-- ============================================================================
-- 설정 완료
-- ============================================================================
-- Supabase 데이터베이스 설정이 완료되었습니다.
-- 다음 단계:
-- 1. 이 파일을 Supabase 대시보드 > SQL Editor에서 실행
-- 2. supabase-schema-community.sql도 추가 실행 (커뮤니티 5개 테이블)
-- 3. Storage 버킷 생성 (Supabase 대시보드 > Storage)
--    - avatars (public)
--    - submissions (public)
--    - pullletters (private)
-- 4. 각 버킷에 RLS 정책 설정
-- 5. Stripe Webhook 설정
-- 6. Vercel 환경변수 설정 (.env.example 참조)
-- 7. 관리자 계정 생성 후 role = 'admin' 으로 UPDATE
