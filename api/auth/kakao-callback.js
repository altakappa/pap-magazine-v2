/**
 * GET /api/auth/kakao-callback
 * Handle Kakao OAuth callback directly (without Supabase OAuth)
 * Exchanges code for token, gets user info, creates/finds Supabase user
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { sendOAuthSuccessHtml } = require('../_lib/oauthSuccess');

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

    // 2026-07-20 보안 교정: 검증된(is_email_verified) 이메일만 기존 계정 매칭에 사용한다.
    // 카카오가 넘긴 미검증 이메일을 신뢰하면, 공격자가 victim@pap-magazine.com(어드민)
    // 등으로 미검증 이메일을 설정해 '카카오 로그인'만으로 그 계정을 탈취할 수 있다.
    // (google-callback.js의 email_verified 가드와 동일 수준으로 통일)
    const kakaoAcc = kakaoUser.kakao_account || {};
    const verifiedEmail = (kakaoAcc.is_email_verified === true && kakaoAcc.email)
      ? String(kakaoAcc.email).trim().toLowerCase()
      : null;
    // 매칭/저장에 쓰는 이메일: 검증된 것이 있으면 그것, 없으면 provider 고유 placeholder.
    const email = verifiedEmail || `kakao_${kakaoId}@kakao.papkorea.com`;

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
      // 검증된 이메일이 있을 때만 이메일로 기존 계정과 매칭한다(미검증이면 탈취 방지 위해
      // 매칭하지 않고 새 계정 흐름으로). 대소문자 무관(ilike).
      const { data: emailProfiles } = verifiedEmail
        ? await supabaseAdmin
            .from('profiles')
            .select('id, name, role, subscription_plan')
            .ilike('email', verifiedEmail)
            .limit(1)
        : { data: null };

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

        // Wait for profile trigger, then reconcile.
        await new Promise(r => setTimeout(r, 1000));

        // 2026-07-20 — 기존 프로필이 이미 있으면(트리거·이메일가입 등) role/subscription_plan을
        // 절대 덮어쓰지 않는다. 폴백 경로가 유료·admin 회원을 free/member로 강등하던 결함 방지.
        const { data: existing } = await supabaseAdmin
          .from('profiles')
          .select('id, name, role, subscription_plan')
          .eq('id', userId)
          .maybeSingle();

        if (existing) {
          const patch = { provider: 'kakao', provider_id: `kakao_${kakaoId}` };
          if (!existing.name) patch.name = nickname;
          await supabaseAdmin.from('profiles').update(patch).eq('id', userId);
          profile = existing;
        } else {
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
          const { data: newProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, name, role, subscription_plan')
            .eq('id', userId)
            .single();
          profile = newProfile;
        }
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
    // 2026-07-12 — 쿼리(초기 IIFE 제거)·프래그먼트(Safari ITP 제거) 모두 위험이
    // 있어, 페이스북(callback.js)이 검증한 HTML 직접 반환 방식으로 통일한다.
    return sendOAuthSuccessHtml(res, token, user);
  } catch (error) {
    console.error('Kakao callback error:', error.code || 'UNKNOWN');
    return res.redirect(302, `${frontendUrl}/auth.html?error=auth_failed&mode=login`);
  }
};
