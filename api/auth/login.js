/**
 * POST /api/auth/login
 * Authenticate user with email/password via Supabase Auth
 */

const { supabase, supabaseAdmin } = require('../_lib/supabase');
const { generateToken, setAuthCookie } = require('../_lib/auth');
const { setCsrfCookie } = require('../_lib/csrf');
const { handleCors } = require('../_lib/cors');
const { rateLimitStrict, rateLimitAccount, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (await rateLimitStrict(req, res, RATE_LIMITS.auth, 'login')) return;

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // 보안 감사 ③ — 계정 단위 레이트리밋(IP 리밋과 병행). IP 를 바꿔가며 이
    // 계정을 노리는 분산 브루트포스를 계정별 총 시도(15회/15분)로 제한.
    if (await rateLimitAccount(res, email, { limit: 15, windowMs: 15 * 60 * 1000, name: 'login:acct' })) return;

    // Authenticate via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      // Try to distinguish error types for better UX
      var errMsg = authError.message || '';
      return res.status(401).json({ message: 'Invalid email or password', code: 'AUTH_ERROR' });
    }

    const userId = authData.user.id;

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    /* 정지된 계정은 토큰을 받지 못한다 (2026-11-13).
     *
     * 그전까지 subscription_status='suspended' 는 **아무것도 막지 않았다.**
     * 관리자 화면에서 '정지' 로 바꿀 수 있는데(member-update.js 의 허용 목록),
     * 로그인 핸들러는 그 칸을 보지 않았다. 즉 정지시킨 계정이 그대로 들어왔다.
     * 2026-11-10 Serena 계정 정리 때 발견했고, 그때는 auth.users.banned_until
     * 로 우회했다 — 구조는 그대로 남아 있었다.
     *
     * cancelled·inactive 는 막지 않는다. 구독이 끝난 사람은 무료 회원으로
     * 계속 들어와야 한다. 행정적으로 멈춘 상태는 'suspended' 하나다.
     *
     * 응답 문구는 영어 한 줄로 둔다 — 프런트가 code 로 9개 언어 토스트를
     * 고르지만, 매핑이 빠져도 사용자가 읽고 무엇을 해야 할지 아는 문장이
     * 남아야 한다. */
    if (String(profile && profile.subscription_status || '').toLowerCase() === 'suspended') {
      try { console.warn('[login] 정지 계정 로그인 차단 user=%s', userId); } catch (_) {}
      return res.status(401).json({
        message: 'This account is suspended. Please contact contact@pap-magazine.com',
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    const user = {
      id: userId,
      email: profile?.email || email,
      name: profile?.display_name || profile?.name || '',
      role: profile?.role || 'member',
      subscription: profile?.subscription_plan || profile?.plan || 'free',
      token_version: profile?.token_version || 0,
    };

    const token = generateToken(user);

    // Set httpOnly auth cookie (XSS-safe) + CSRF token
    setAuthCookie(res, token);
    setCsrfCookie(res);

    return res.status(200).json({ token, user });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Login failed. Please try again.' });
  }
};
