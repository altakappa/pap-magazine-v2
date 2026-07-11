/**
 * GET /api/auth/kakao-callback
 * Handle Kakao OAuth callback directly (without Supabase OAuth)
 * Exchanges code for token, gets user info, creates/finds Supabase user
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.papkorea.com';

  try {
    const { code, state: stateParam } = req.query;

    if (!code) {
      return res.redirect(302, `${frontendUrl}/auth.html?error=missing_code&mode=login`);
    }

    // Verify CSRF state parameter
    function parseCookies(cookieHeader) {
      var cookies = {};
      if (!cookieHeader) return cookies;
      cookieHeader.split(';').forEach(function (c) {
        var parts = c.trim().split('=');
        var key = parts.shift();
        cookies[key] = parts.join('=');
      });
      return cookies;
    }
    const cookies = parseCookies(req.headers.cookie);
    const storedState = cookies.oauth_state;

    if (!stateParam || !storedState || stateParam !== storedState) {
      console.error('Kakao OAuth state mismatch — possible CSRF attack');
      return res.redirect(302, `${frontendUrl}/auth.html?error=state_mismatch&mode=login`);
    }

    const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID;
    const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET;
    if (!KAKAO_CLIENT_ID || !KAKAO_CLIENT_SECRET) {
      console.error('Kakao OAuth environment variables are not set');
      return res.redirect(302, `${frontendUrl}/auth.html?error=oauth_config_error&mode=login`);
    }
    const REDIRECT_URI = `${frontendUrl}/api/auth/kakao-callback`;

    // 1. Exchange authorization code for access token
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KAKAO_CLIENT_ID,
        client_secret: KAKAO_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error('Kakao token error:', tokenData);
      return res.redirect(302, `${frontendUrl}/auth.html?error=kakao_token_failed&mode=login`);
    }

    // 2. Get user info from Kakao
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const kakaoUser = await userRes.json();

    const kakaoId = kakaoUser.id;
    const nickname = kakaoUser.properties?.nickname || kakaoUser.kakao_account?.profile?.nickname || '';
    const profileImage = kakaoUser.properties?.profile_image || kakaoUser.kakao_account?.profile?.profile_image_url || '';
    const kakaoEmail = kakaoUser.kakao_account?.email || null;

    // Use kakao email if available, otherwise generate a placeholder
    const email = kakaoEmail || `kakao_${kakaoId}@kakao.papkorea.com`;

    // 3. Find or create user in Supabase
    // First, check if user already exists by looking up profiles
    const { data: existingProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, name, role, subscription_plan')
      .eq('provider_id', `kakao_${kakaoId}`)
      .limit(1);

    let userId;
    let profile;

    if (existingProfiles && existingProfiles.length > 0) {
      // Existing user
      userId = existingProfiles[0].id;
      profile = existingProfiles[0];
    } else {
      // Check by email
      const { data: emailProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, name, role, subscription_plan')
        .eq('email', email)
        .limit(1);

      if (emailProfiles && emailProfiles.length > 0) {
        userId = emailProfiles[0].id;
        profile = emailProfiles[0];
        // Update provider_id
        await supabaseAdmin
          .from('profiles')
          .update({ provider_id: `kakao_${kakaoId}` })
          .eq('id', userId);
      } else {
        // Create new user in Supabase Auth
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            name: nickname,
            avatar_url: profileImage,
            provider: 'kakao',
            kakao_id: kakaoId,
          },
        });

        if (createError) {
          // User might exist in auth but not in profiles
          const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
          const existingUser = users?.find(u => u.email === email);
          if (existingUser) {
            userId = existingUser.id;
          } else {
            throw createError;
          }
        } else {
          userId = newUser.user.id;
        }

        // Wait for profile trigger, then update
        await new Promise(r => setTimeout(r, 1000));

        await supabaseAdmin
          .from('profiles')
          .upsert({
            id: userId,
            email,
            name: nickname,
            avatar_url: profileImage,
            provider: 'kakao',
            provider_id: `kakao_${kakaoId}`,
            role: 'member',
            subscription_plan: 'free',
          });

        // Re-fetch profile
        const { data: newProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, name, role, subscription_plan')
          .eq('id', userId)
          .single();

        profile = newProfile;
      }
    }

    // 4. Generate JWT and redirect to frontend
    const user = {
      id: userId,
      email,
      name: profile?.name || nickname,
      role: profile?.role || 'member',
      subscription: profile?.subscription_plan || 'free',
      token_version: profile?.token_version || 0,
    };

    const token = generateToken(user);
    // 2026-07-12 — ?oauth=success 쿼리는 프론트 초기 IIFE가 지워버려 신규
    // 로그인이 완료되지 않던 잠복 버그. 해시는 보존되므로 프론트가 정식
    // 지원하는 해시-토큰(#token=...&user=...)으로 넘긴다. (프래그먼트는 서버
    // 로그/리퍼러에 남지 않음 — 기존 설계 주석과 동일 취지)
    const userJson = encodeURIComponent(JSON.stringify({
      id: user.id, email: user.email, name: user.name,
      role: user.role, subscription: user.subscription,
    }));
    res.setHeader('Set-Cookie', [
      'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ]);
    return res.redirect(302, `${frontendUrl}/auth.html#token=${encodeURIComponent(token)}&user=${userJson}`);
  } catch (error) {
    console.error('Kakao callback error:', error.code || 'UNKNOWN');
    return res.redirect(302, `${frontendUrl}/auth.html?error=auth_failed&mode=login`);
  }
};
