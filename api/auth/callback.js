/**
 * GET /api/auth/callback
 * Handle OAuth callback from Supabase (Google/Facebook)
 * Reads PKCE code_verifier from cookie, exchanges code for session, generates JWT
 */

const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(function (c) {
    var parts = c.trim().split('=');
    var key = parts.shift();
    cookies[key] = parts.join('=');
  });
  return cookies;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.papkorea.com';

  try {
    const { code, error: oauthError, error_description } = req.query;

    if (oauthError) {
      console.error('OAuth error from provider:', oauthError, error_description);
      return res.redirect(302, `${frontendUrl}/auth?error=auth_failed&detail=${encodeURIComponent(error_description || oauthError)}&mode=login`);
    }

    if (!code) {
      return res.redirect(302, `${frontendUrl}/auth?error=missing_code&mode=login`);
    }

    // Read PKCE code_verifier from cookie (set by google.js / facebook.js)
    const cookies = parseCookies(req.headers.cookie);
    const codeVerifier = cookies.pkce_verifier;

    console.log('Callback received code, has verifier:', !!codeVerifier);

    // Create supabase client with PKCE verifier in custom storage
    const storage = {
      getItem: function (key) {
        if (key.includes('code-verifier')) return codeVerifier || null;
        return null;
      },
      setItem: function () {},
      removeItem: function () {},
    };

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { flowType: 'pkce', storage, autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
    );

    // Exchange the code for a session (using the PKCE verifier from cookie)
    const { data: authData, error: authError } = await supabase.auth.exchangeCodeForSession(code);

    if (authError) {
      console.error('Code exchange error:', authError.message);
      return res.redirect(302, `${frontendUrl}/auth?error=auth_failed&detail=${encodeURIComponent(authError.message)}&mode=login`);
    }

    const userId = authData.user.id;
    const email = authData.user.email;

    // Fetch or wait for profile (trigger may take a moment)
    let profile;
    for (let i = 0; i < 3; i++) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (data) { profile = data; break; }
      await new Promise(function (r) { setTimeout(r, 500); });
    }

    // If no profile exists yet, create one
    if (!profile) {
      const meta = authData.user.user_metadata || {};
      const { data: newProfile } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: userId,
          email: email,
          display_name: meta.full_name || meta.name || '',
          role: 'member',
        })
        .select('*')
        .single();
      profile = newProfile;
    }

    const user = {
      id: userId,
      email,
      name: profile?.display_name || profile?.name || authData.user.user_metadata?.name || '',
      role: profile?.role || 'member',
      subscription: profile?.subscription_plan || profile?.plan || 'free',
    };

    const token = generateToken(user);
    const userJson = encodeURIComponent(JSON.stringify(user));

    // Clear the PKCE cookie and redirect with token
    res.setHeader('Set-Cookie', 'pkce_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return res.redirect(302, `${frontendUrl}/auth?token=${token}&user=${userJson}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.redirect(302, `${frontendUrl}/auth?error=auth_failed&detail=${encodeURIComponent(error.message || 'Unknown')}&mode=login`);
  }
};
