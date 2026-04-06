/**
 * PAP Magazine Backend Integration Module
 *
 * 이 모듈은 Supabase와 Stripe를 사용한 완전한 백엔드 통합을 제공합니다.
 * 모든 페이지에서 <script src="js/pap-backend.js"></script>로 포함할 수 있습니다.
 *
 * 기능:
 * - Supabase 인증 (회원가입, 로그인, OAuth)
 * - Stripe 결제 처리
 * - 사용자 프로필 관리
 * - 파일 업로드
 * - 폼 제출 (편집자료, 풀레터)
 */

// ============================================================================
// 설정 (Configuration)
// ============================================================================
const PAP_CONFIG = {
  // Supabase 설정 - YOUR_SUPABASE_URL와 YOUR_SUPABASE_ANON_KEY를 실제 값으로 교체하세요
  // Supabase 프로젝트 설정에서 찾을 수 있습니다: https://app.supabase.com/project/_/settings/api
  SUPABASE_URL: 'https://igcazquhkwxtqsaqpznx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnY2F6cXVoa3d4dHFzYXFwem54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMzg2MjgsImV4cCI6MjA4OTkxNDYyOH0.oCl_Rq1dSoM1Q67sJnp1YrO2rN_2N5XmxAkVFk_hAa8',

  // ⚠️ SECURITY: Validate credentials before initialization
  _validateConfig: function() {
    if (this.SUPABASE_URL === 'YOUR_SUPABASE_URL' || this.SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
      console.error('⚠️ PAP_CONFIG: Supabase credentials are not configured. Set real values before deployment.');
      return false;
    }
    if (this.STRIPE_PUBLIC_KEY === 'YOUR_STRIPE_PUBLIC_KEY') {
      console.warn('⚠️ PAP_CONFIG: Stripe key not configured. Payments will not work.');
    }
    return true;
  },

  // Stripe 설정 - Publishable Key (공개 키)
  // Stripe 대시보드에서 찾을 수 있습니다: https://dashboard.stripe.com/apikeys
  STRIPE_PUBLIC_KEY: 'YOUR_STRIPE_PUBLIC_KEY',    // e.g., pk_live_xxxxx

  // 결제 플랜 설정
  STRIPE_PLANS: {
    free: {
      name: 'Free',
      price: 0,
      stripe_price_id: null, // Free plan doesn't need Stripe
    },
    standard_monthly: {
      name: 'Standard Monthly',
      price: 9.99,
      stripe_price_id: 'price_xxxxx', // Set in Stripe dashboard
    },
    standard_yearly: {
      name: 'Standard Yearly',
      price: 99.99,
      stripe_price_id: 'price_xxxxx',
    },
    premium_monthly: {
      name: 'Premium Monthly',
      price: 19.99,
      stripe_price_id: 'price_xxxxx',
    },
    premium_yearly: {
      name: 'Premium Yearly',
      price: 199.99,
      stripe_price_id: 'price_xxxxx',
    },
  },

  // Stripe Checkout 리다이렉트 URL
  STRIPE_SUCCESS_URL: window.location.origin + '/subscribe.html?session_id={CHECKOUT_SESSION_ID}',
  STRIPE_CANCEL_URL: window.location.origin + '/subscribe.html?canceled=true',
};

// ============================================================================
// 전역 변수 (Global State)
// ============================================================================
let supabaseClient = null;
let stripeInstance = null;
let currentUser = null;

// ============================================================================
// 초기화 함수 (Initialization)
// ============================================================================

/**
 * PAP 백엔드 초기화
 * 페이지 로드 후 자동으로 실행됩니다.
 */
// Production mode: suppress verbose logging
var PAP_DEBUG = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
function papLog() { if(PAP_DEBUG) console.log.apply(console, arguments); }

async function initPAPBackend() {
  papLog('🚀 PAP Backend Initializing...');

  // API 키 확인
  if (!validateAPIKeys()) {
    console.warn('⚠️  API keys not properly configured. Please set them in PAP_CONFIG.');
    return false;
  }

  try {
    // Supabase 클라이언트 초기화
    await loadSupabaseClient();

    // Stripe 초기화
    await loadStripeClient();

    // 현재 사용자 확인
    await checkCurrentUser();

    papLog('✅ PAP Backend initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ PAP Backend initialization failed:', error);
    return false;
  }
}

/**
 * API 키 유효성 검사
 */
function validateAPIKeys() {
  const missingKeys = [];

  if (!PAP_CONFIG.SUPABASE_URL || PAP_CONFIG.SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    missingKeys.push('SUPABASE_URL');
  }
  if (!PAP_CONFIG.SUPABASE_ANON_KEY || PAP_CONFIG.SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    missingKeys.push('SUPABASE_ANON_KEY');
  }
  if (!PAP_CONFIG.STRIPE_PUBLIC_KEY || PAP_CONFIG.STRIPE_PUBLIC_KEY === 'YOUR_STRIPE_PUBLIC_KEY') {
    missingKeys.push('STRIPE_PUBLIC_KEY');
  }

  if (missingKeys.length > 0) {
    console.warn(`⚠️  Missing API keys: ${missingKeys.join(', ')}`);
    return false;
  }

  return true;
}

/**
 * Supabase 클라이언트 로드 및 초기화
 */
async function loadSupabaseClient() {
  return new Promise((resolve, reject) => {
    // Supabase JS 라이브러리를 동적으로 로드
    if (typeof window.supabase !== 'undefined') {
      const { createClient } = window.supabase;
      supabaseClient = createClient(
        PAP_CONFIG.SUPABASE_URL,
        PAP_CONFIG.SUPABASE_ANON_KEY
      );
      papLog('✅ Supabase client initialized');
      resolve();
      return;
    }

    // CDN에서 라이브러리 로드
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.async = true;
    script.onload = () => {
      setTimeout(() => {
        const { createClient } = window.supabase;
        supabaseClient = createClient(
          PAP_CONFIG.SUPABASE_URL,
          PAP_CONFIG.SUPABASE_ANON_KEY
        );
        papLog('✅ Supabase client initialized');
        resolve();
      }, 100);
    };
    script.onerror = () => {
      reject(new Error('Failed to load Supabase library'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Stripe 클라이언트 로드 및 초기화
 */
async function loadStripeClient() {
  return new Promise((resolve, reject) => {
    // Stripe.js 라이브러리를 동적으로 로드
    if (typeof window.Stripe !== 'undefined') {
      stripeInstance = Stripe(PAP_CONFIG.STRIPE_PUBLIC_KEY);
      papLog('✅ Stripe client initialized');
      resolve();
      return;
    }

    // CDN에서 라이브러리 로드
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = () => {
      setTimeout(() => {
        stripeInstance = Stripe(PAP_CONFIG.STRIPE_PUBLIC_KEY);
        papLog('✅ Stripe client initialized');
        resolve();
      }, 100);
    };
    script.onerror = () => {
      reject(new Error('Failed to load Stripe library'));
    };
    document.head.appendChild(script);
  });
}

/**
 * 현재 로그인한 사용자 확인
 */
async function checkCurrentUser() {
  if (!supabaseClient) return;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      papLog('👤 Current user: authenticated');

      // 인증 상태 변경 리스너 등록
      papAuth.onAuthStateChange((user) => {
        currentUser = user;
        papLog('👤 Auth state changed:', user ? 'logged in' : 'logged out');
      });
    }
  } catch (error) {
    console.error('Error checking current user:', error);
  }
}

// ============================================================================
// 인증 모듈 (Authentication Module)
// ============================================================================
const papAuth = {
  /**
   * 회원가입 (이메일, 비밀번호)
   * @param {string} email - 사용자 이메일
   * @param {string} password - 비밀번호 (최소 6자)
   * @param {string} name - 사용자 이름
   * @returns {Promise<{user, error}>}
   */
  async signUp(email, password, name) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');

      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name,
          },
        },
      });

      if (error) throw error;

      // 프로필 생성
      if (data.user) {
        await papUser.createProfile({
          id: data.user.id,
          email: data.user.email,
          name: name,
        });
      }

      papLog('✅ Sign up successful');
      return { user: data.user, error: null };
    } catch (error) {
      console.error('❌ Sign up error:', error);
      return { user: null, error: error.message };
    }
  },

  /**
   * 로그인 (이메일, 비밀번호)
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{user, session, error}>}
   */
  async signIn(email, password) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');

      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      currentUser = data.user;
      papLog('✅ Sign in successful');
      return { user: data.user, session: data.session, error: null };
    } catch (error) {
      console.error('❌ Sign in error:', error);
      return { user: null, session: null, error: error.message };
    }
  },

  /**
   * OAuth 제공자로 로그인 (Google, Apple)
   * @param {string} provider - 'google' 또는 'apple'
   * @returns {Promise<{error}>}
   */
  async signInWithProvider(provider) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');
      if (!['google', 'apple'].includes(provider)) {
        throw new Error(`Invalid provider: ${provider}`);
      }

      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${window.location.origin}/auth.html`,
        },
      });

      if (error) throw error;

      papLog(`✅ ${provider} OAuth sign in initiated`);
      return { error: null };
    } catch (error) {
      console.error(`❌ ${provider} sign in error:`, error);
      return { error: error.message };
    }
  },

  /**
   * 로그아웃
   * @returns {Promise<{error}>}
   */
  async signOut() {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');

      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;

      currentUser = null;
      papLog('✅ Sign out successful');
      return { error: null };
    } catch (error) {
      console.error('❌ Sign out error:', error);
      return { error: error.message };
    }
  },

  /**
   * 현재 로그인한 사용자 반환
   * @returns {object|null}
   */
  getUser() {
    return currentUser;
  },

  /**
   * 현재 세션 정보 반환
   * @returns {Promise<session>}
   */
  async getSession() {
    if (!supabaseClient) return null;
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
  },

  /**
   * 인증 상태 변경 리스너 등록
   * @param {Function} callback - 상태 변경 시 호출할 콜백 함수
   * @returns {Function} - 리스너 구독 해제 함수
   */
  onAuthStateChange(callback) {
    if (!supabaseClient) return () => {};

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(
      (event, session) => {
        callback(session?.user || null);
      }
    );

    return () => subscription?.unsubscribe();
  },

  /**
   * 사용자가 로그인되어 있는지 확인
   * @returns {boolean}
   */
  isLoggedIn() {
    return currentUser !== null;
  },

  /**
   * 비밀번호 재설정 이메일 전송
   * @param {string} email
   * @returns {Promise<{error}>}
   */
  async resetPassword(email) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');

      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth.html?type=password_reset`,
      });

      if (error) throw error;

      papLog('✅ Password reset email sent');
      return { error: null };
    } catch (error) {
      console.error('❌ Password reset error:', error);
      return { error: error.message };
    }
  },

  /**
   * 새로운 비밀번호 업데이트
   * @param {string} newPassword
   * @returns {Promise<{user, error}>}
   */
  async updatePassword(newPassword) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');

      const { data, error } = await supabaseClient.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      papLog('✅ Password updated successfully');
      return { user: data.user, error: null };
    } catch (error) {
      console.error('❌ Update password error:', error);
      return { user: null, error: error.message };
    }
  },
};

// ============================================================================
// 사용자 프로필 모듈 (User Profile Module)
// ============================================================================
const papUser = {
  /**
   * 사용자 프로필 생성
   * @param {object} data - 프로필 데이터
   */
  async createProfile(data) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');

      const { error } = await supabaseClient
        .from('profiles')
        .insert([{
          id: data.id,
          email: data.email,
          name: data.name,
          subscription_plan: 'free',
          subscription_status: 'inactive',
          created_at: new Date().toISOString(),
        }]);

      if (error) throw error;

      papLog('✅ Profile created');
      return { error: null };
    } catch (error) {
      console.error('❌ Profile creation error:', error);
      return { error: error.message };
    }
  },

  /**
   * 사용자 프로필 가져오기
   * @param {string} userId - (선택사항) 사용자 ID, 미지정 시 현재 사용자
   * @returns {Promise<{profile, error}>}
   */
  async getProfile(userId = null) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');

      const id = userId || currentUser?.id;
      if (!id) throw new Error('User not logged in');

      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      return { profile: data, error: null };
    } catch (error) {
      console.error('❌ Get profile error:', error);
      return { profile: null, error: error.message };
    }
  },

  /**
   * 사용자 프로필 업데이트
   * @param {object} updates - 업데이트할 필드들
   * @returns {Promise<{profile, error}>}
   */
  async updateProfile(updates) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');
      if (!currentUser) throw new Error('User not logged in');

      const { data, error } = await supabaseClient
        .from('profiles')
        .update(updates)
        .eq('id', currentUser.id)
        .select()
        .single();

      if (error) throw error;

      papLog('✅ Profile updated successfully');
      return { profile: data, error: null };
    } catch (error) {
      console.error('❌ Update profile error:', error);
      return { profile: null, error: error.message };
    }
  },

  /**
   * 사용자 구독 상태 가져오기
   * @returns {Promise<{subscription, error}>}
   */
  async getSubscription() {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');
      if (!currentUser) throw new Error('User not logged in');

      const { data, error } = await supabaseClient
        .from('subscribers')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows

      return { subscription: data || null, error: null };
    } catch (error) {
      console.error('❌ Get subscription error:', error);
      return { subscription: null, error: error.message };
    }
  },

  /**
   * 프로필에 아바타 업로드
   * @param {File} file
   * @returns {Promise<{url, error}>}
   */
  async uploadAvatar(file) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');
      if (!currentUser) throw new Error('User not logged in');

      const fileName = `${currentUser.id}_${Date.now()}_${file.name}`;

      const { data, error } = await supabaseClient.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (error) throw error;

      // 공개 URL 생성
      const { data: publicUrl } = supabaseClient.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // 프로필 업데이트
      await papUser.updateProfile({ avatar_url: publicUrl.publicUrl });

      papLog('✅ Avatar uploaded successfully');
      return { url: publicUrl.publicUrl, error: null };
    } catch (error) {
      console.error('❌ Avatar upload error:', error);
      return { url: null, error: error.message };
    }
  },
};

// ============================================================================
// 결제 모듈 (Payment Module)
// ============================================================================
const papPayment = {
  /**
   * Stripe Checkout 세션 생성
   * @param {string} planId - 플랜 ID (free, standard_monthly, premium_yearly 등)
   * @param {string} billingCycle - 'monthly' 또는 'yearly'
   * @returns {Promise<{url, error}>}
   */
  async createCheckout(planId, billingCycle = 'monthly') {
    try {
      if (!stripeInstance) throw new Error('Stripe not initialized');
      if (!currentUser) throw new Error('User not logged in');

      const plan = PAP_CONFIG.STRIPE_PLANS[planId];
      if (!plan) throw new Error(`Invalid plan ID: ${planId}`);

      // Free 플랜인 경우 Stripe 체크아웃이 필요 없음
      if (planId === 'free') {
        // 데이터베이스에 구독 레코드 생성
        await papPayment.updateSubscription({
          user_id: currentUser.id,
          plan: 'free',
          billing_cycle: null,
          status: 'active',
        });

        papLog('✅ Free plan activated');
        return { url: null, error: null, sessionId: null };
      }

      // Stripe Checkout API 호출 (Vercel/Netlify 서버리스 함수를 통해)
      // 실제 구현에서는 백엔드 함수 호출이 필요합니다
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId: plan.stripe_price_id,
          userId: currentUser.id,
          email: currentUser.email,
          successUrl: PAP_CONFIG.STRIPE_SUCCESS_URL,
          cancelUrl: PAP_CONFIG.STRIPE_CANCEL_URL,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      const { sessionId, url } = await response.json();

      papLog('✅ Checkout session created:', sessionId);
      return { url, error: null, sessionId };
    } catch (error) {
      console.error('❌ Create checkout error:', error);
      return { url: null, error: error.message, sessionId: null };
    }
  },

  /**
   * Stripe Checkout URL로 리다이렉트
   * @param {string} planId
   * @param {string} billingCycle
   */
  async redirectToCheckout(planId, billingCycle = 'monthly') {
    const { url, error } = await papPayment.createCheckout(planId, billingCycle);

    if (error) {
      alert(`결제 준비 실패: ${error}`);
      return;
    }

    if (url) {
      window.location.href = url;
    } else {
      // Free plan
      window.location.href = '/subscribe.html?plan=free';
    }
  },

  /**
   * 구독 정보 업데이트 (Webhook에 의해 호출됨)
   * @param {object} data
   */
  async updateSubscription(data) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');

      // 기존 구독 레코드 확인
      const { data: existing } = await supabaseClient
        .from('subscribers')
        .select('id')
        .eq('user_id', data.user_id)
        .single();

      let result;
      if (existing) {
        // 기존 레코드 업데이트
        result = await supabaseClient
          .from('subscribers')
          .update(data)
          .eq('user_id', data.user_id)
          .select()
          .single();
      } else {
        // 새 레코드 생성
        result = await supabaseClient
          .from('subscribers')
          .insert([{
            user_id: data.user_id,
            stripe_customer_id: data.stripe_customer_id || null,
            plan: data.plan,
            billing_cycle: data.billing_cycle,
            status: data.status || 'active',
            current_period_end: data.current_period_end,
            created_at: new Date().toISOString(),
          }])
          .select()
          .single();
      }

      if (result.error) throw result.error;

      // 프로필의 구독 정보도 업데이트
      await supabaseClient
        .from('profiles')
        .update({
          subscription_plan: data.plan,
          subscription_status: data.status,
        })
        .eq('id', data.user_id);

      papLog('✅ Subscription updated:', data.user_id);
      return { error: null };
    } catch (error) {
      console.error('❌ Update subscription error:', error);
      return { error: error.message };
    }
  },

  /**
   * 구독 취소
   * @returns {Promise<{error}>}
   */
  async cancelSubscription() {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');
      if (!currentUser) throw new Error('User not logged in');

      // 백엔드 함수 호출하여 Stripe 구독 취소
      const response = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: currentUser.id,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      papLog('✅ Subscription cancelled');
      return { error: null };
    } catch (error) {
      console.error('❌ Cancel subscription error:', error);
      return { error: error.message };
    }
  },
};

// ============================================================================
// 폼 제출 모듈 (Form Submission Module)
// ============================================================================
const papSubmit = {
  /**
   * 편집 자료 제출
   * @param {object} formData
   * @returns {Promise<{submission, error}>}
   */
  async submitEditorial(formData) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');
      if (!currentUser) throw new Error('User not logged in');

      const { data, error } = await supabaseClient
        .from('submissions')
        .insert([{
          user_id: currentUser.id,
          title: formData.title,
          description: formData.description,
          file_urls: formData.file_urls || [],
          credits: formData.credits || null,
          status: 'pending',
          created_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;

      papLog('✅ Editorial submission saved:', data.id);
      return { submission: data, error: null };
    } catch (error) {
      console.error('❌ Submit editorial error:', error);
      return { submission: null, error: error.message };
    }
  },

  /**
   * 풀레터 요청 제출
   * @param {object} formData
   * @returns {Promise<{pulletter, error}>}
   */
  async submitPullLetter(formData) {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');
      if (!currentUser) throw new Error('User not logged in');

      const { data, error } = await supabaseClient
        .from('pullletters')
        .insert([{
          user_id: currentUser.id,
          request_text: formData.request_text,
          file_urls: formData.file_urls || [],
          status: 'pending',
          created_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;

      papLog('✅ Pull letter submission saved:', data.id);
      return { pulletter: data, error: null };
    } catch (error) {
      console.error('❌ Submit pull letter error:', error);
      return { pulletter: null, error: error.message };
    }
  },

  /**
   * 파일 업로드 (Supabase Storage)
   * @param {File} file
   * @param {string} bucket - 버킷명 (submissions, pullletters 등)
   * @returns {Promise<{url, error}>}
   */
  async uploadFile(file, bucket = 'submissions') {
    try {
      if (!supabaseClient) throw new Error('Supabase not initialized');
      if (!currentUser) throw new Error('User not logged in');

      // 파일 크기 제한 (10MB)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error('File size exceeds 10MB limit');
      }

      // 파일명 생성 (사용자ID_타임스탐프_원본파일명)
      const fileName = `${currentUser.id}/${Date.now()}_${file.name}`;

      const { data, error } = await supabaseClient.storage
        .from(bucket)
        .upload(fileName, file);

      if (error) throw error;

      // 공개 URL 생성
      const { data: publicUrl } = supabaseClient.storage
        .from(bucket)
        .getPublicUrl(fileName);

      papLog('✅ File uploaded:', fileName);
      return { url: publicUrl.publicUrl, path: data.path, error: null };
    } catch (error) {
      console.error('❌ File upload error:', error);
      return { url: null, path: null, error: error.message };
    }
  },

  /**
   * 여러 파일 한번에 업로드
   * @param {FileList|File[]} files
   * @param {string} bucket
   * @returns {Promise<{urls, errors}>}
   */
  async uploadFiles(files, bucket = 'submissions') {
    try {
      const uploadPromises = Array.from(files).map(file =>
        papSubmit.uploadFile(file, bucket)
      );

      const results = await Promise.all(uploadPromises);

      const urls = results
        .filter(r => !r.error)
        .map(r => r.url);

      const errors = results
        .filter(r => r.error)
        .map((r, i) => `${files[i].name}: ${r.error}`);

      if (errors.length > 0) {
        console.warn('⚠️  Some files failed to upload:', errors);
      }

      return { urls, errors };
    } catch (error) {
      console.error('❌ Upload files error:', error);
      return { urls: [], errors: [error.message] };
    }
  },
};

// ============================================================================
// 유틸리티 함수 (Utility Functions)
// ============================================================================

/**
 * 에러 메시지를 사용자 친화적으로 변환
 * @param {string} errorCode
 * @returns {string}
 */
function getHumanReadableError(errorCode) {
  const errors = {
    'user_already_exists': '이미 등록된 이메일입니다.',
    'invalid_grant': '이메일 또는 비밀번호가 잘못되었습니다.',
    'email_not_confirmed': '이메일 확인이 필요합니다. 이메일을 확인해주세요.',
    'invalid_credentials': '로그인 정보가 유효하지 않습니다.',
    'weak_password': '비밀번호가 너무 간단합니다. (최소 6자)',
    'invalid_email': '유효한 이메일 주소를 입력해주세요.',
  };

  return errors[errorCode] || '오류가 발생했습니다. 다시 시도해주세요.';
}

/**
 * 로컬스토리지에서 값 가져오기 (JSON 파싱)
 * @param {string} key
 * @param {any} defaultValue
 */
function getStorageItem(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * 로컬스토리지에 값 저장 (JSON 직렬화)
 * @param {string} key
 * @param {any} value
 */
function setStorageItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Storage error:', error);
  }
}

/**
 * 비동기 작업 재시도
 * @param {Function} asyncFn
 * @param {number} maxRetries
 * @param {number} delay
 */
async function retryAsync(asyncFn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await asyncFn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ============================================================================
// 자동 초기화 및 이벤트 리스너
// ============================================================================

// 페이지 로드 시 백엔드 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPAPBackend);
} else {
  initPAPBackend();
}

// 창 포커스 시 사용자 세션 재확인
window.addEventListener('focus', async () => {
  const session = await papAuth.getSession();
  if (!session && currentUser) {
    currentUser = null;
    papLog('👤 Session expired');
  }
});

// ============================================================================
// 공개 API 내보내기 (Public API)
// ============================================================================
// papAuth, papUser, papPayment, papSubmit는 이미 전역으로 정의됨
// 추가 유틸리티 내보내기
window.PAP = {
  config: PAP_CONFIG,
  auth: papAuth,
  user: papUser,
  payment: papPayment,
  submit: papSubmit,
  getUser: () => currentUser,
  isLoggedIn: () => currentUser !== null,
  utils: {
    getHumanReadableError,
    getStorageItem,
    setStorageItem,
    retryAsync,
  },
};

papLog('📦 PAP Backend module loaded. Access via: window.PAP or papAuth, papUser, papPayment, papSubmit');
