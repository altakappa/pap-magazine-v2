/**
 * GET /api/auth/google-callback
 * 2026-07-12 — Google OAuth 콜백을 자체 처리 (Supabase OAuth 우회).
 * code → 토큰 교환 → 사용자 정보 → Supabase 프로필 조회/생성 → PAP 세션 발급.
 * 카카오 콜백(kakao-callback.js)과 동일한 패턴. 매칭은 검증된 이메일 기준
 * (profiles에 provider_id 컬럼이 없으므로 이메일로 조회/생성).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

function getRequestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(function (c) {
    const parts = c.trim().split('=');
    const key = parts.shift();
    cookies[key] = parts.join('=');
  });
  return cookies;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const frontendUrl = getRequestOrigin(req);

  try {
    const { code, state: stateParam, error: oauthError } = req.query;

    if (oauthError) {
      console.error('[google-cb] provider error:', String(oauthError).slice(0, 80));
      return res.redirect(302, `${frontendUrl}/auth.html?error=oauth_denied&mode=login`);
    }
    if (!code) {
      console.error('[google-cb] missing code');
      return res.redirect(302, `${frontendUrl}/auth.html?error=missing_code&mode=login`);
    }

    // CSRF state 검증
    const cookies = parseCookies(req.headers.cookie);
    const storedState = cookies.oauth_state;
    if (!stateParam || !storedState || stateParam !== storedState) {
      console.error('[google-cb] state mismatch — hasParam=' + (!!stateParam) + ' hasCookie=' + (!!storedState) + ' match=' + (stateParam===storedState));
      return res.redirect(302, `${frontendUrl}/auth.html?error=state_mismatch&mode=login`);
    }

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error('Google OAuth environment variables are not set');
      return res.redirect(302, `${frontendUrl}/auth.html?error=oauth_config_error&mode=login`);
    }

    // 인가 요청 때와 반드시 동일한 redirect_uri (같은 호스트로 콜백됨)
    const REDIRECT_URI = `${frontendUrl}/api/auth/google-callback`;

    // 1. code → 토큰 교환
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      console.error('Google token error:', tokenData.error || tokenRes.status);
      return res.redirect(302, `${frontendUrl}/auth.html?error=google_token_failed&mode=login`);
    }

    // 2. 사용자 정보 조회
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const gUser = await userRes.json();
    if (!userRes.ok || !gUser || !gUser.email) {
      console.error('Google userinfo error:', userRes.status);
      return res.redirect(302, `${frontendUrl}/auth.html?error=google_userinfo_failed&mode=login`);
    }

    const email = String(gUser.email).toLowerCase();
    // email_verified가 명시적으로 false인 경우만 거부. Google userinfo가 이 필드를
    // 누락하거나 문자열/불리언으로 주는 변형을 흡수 (OAuth로 받은 Google 이메일은
    // 기본적으로 검증된 것으로 간주). 기존 엄격 판정이 로그인을 막던 원인 제거.
    if (gUser.email_verified === false || gUser.email_verified === 'false') {
      console.error('[google-cb] email not verified:', email);
      return res.redirect(302, `${frontendUrl}/auth.html?error=email_unverified&mode=login`);
    }
    const name = gUser.name || gUser.given_name || (email.split('@')[0]);
    const avatar = gUser.picture || '';

    // 3. 이메일로 프로필 조회 → 없으면 생성
    let userId;
    let profile;

    const { data: emailProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, name, role, subscription_plan, token_version')
      .eq('email', email)
      .limit(1);

    if (emailProfiles && emailProfiles.length > 0) {
      userId = emailProfiles[0].id;
      profile = emailProfiles[0];
    } else {
      // Supabase Auth 사용자 생성
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name, avatar_url: avatar, provider: 'google' },
      });

      if (createError) {
        // Auth엔 있는데 profiles엔 없을 수 있음 → 역조회
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = listData && listData.users
          ? listData.users.find(function (u) { return u.email === email; })
          : null;
        if (existingUser) {
          userId = existingUser.id;
        } else {
          throw createError;
        }
      } else {
        userId = newUser.user.id;
      }

      // 프로필 트리거 대기 후 upsert (존재하는 컬럼만)
      await new Promise(function (r) { setTimeout(r, 1000); });
      await supabaseAdmin
        .from('profiles')
        .upsert({
          id: userId,
          email,
          name,
          avatar_url: avatar,
          role: 'member',
          subscription_plan: 'free',
        });

      const { data: newProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, name, role, subscription_plan, token_version')
        .eq('id', userId)
        .single();
      profile = newProfile;
    }

    // 4. PAP 세션 발급 (카카오와 동일: httpOnly 쿠키 → /auth.html?oauth=success)
    const user = {
      id: userId,
      email,
      name: (profile && profile.name) || name,
      role: (profile && profile.role) || 'member',
      subscription: (profile && profile.subscription_plan) || 'free',
      token_version: (profile && profile.token_version) || 0,
    };

    const token = generateToken(user);
    const userJson = encodeURIComponent(JSON.stringify({
      id: user.id, email: user.email, name: user.name,
      role: user.role, subscription: user.subscription,
    }));

    console.log('[google-cb] success:', email, '→', frontendUrl);
    res.setHeader('Set-Cookie', [
      'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      `pap_oauth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=120`,
      `pap_oauth_user=${userJson}; Path=/; SameSite=Lax; Max-Age=120`,
    ]);
    return res.redirect(302, `${frontendUrl}/auth.html?oauth=success`);
  } catch (error) {
    console.error('Google callback error:', (error && error.code) || 'UNKNOWN');
    return res.redirect(302, `${frontendUrl}/auth.html?error=auth_failed&mode=login`);
  }
};
