/**
 * GET /api/auth/callback
 * Handle OAuth callback from Supabase (Google/Facebook)
 * Exchanges code for tokens via direct HTTP (no Supabase JS client needed)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

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

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  var frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.papkorea.com';

  try {
    var code = req.query.code;
    var oauthError = req.query.error;
    var errorDesc = req.query.error_description;

    if (oauthError) {
      console.error('OAuth error from provider:', oauthError, errorDesc);
      return res.redirect(302, frontendUrl + '/auth?error=oauth_provider&detail=' + encodeURIComponent(errorDesc || oauthError) + '&mode=login');
    }

    if (!code) {
      return res.redirect(302, frontendUrl + '/auth?error=missing_code&mode=login');
    }

    // Read PKCE code_verifier from cookie
    var cookies = parseCookies(req.headers.cookie);
    var codeVerifier = cookies.pkce_verifier;

    console.log('Callback: has code=' + (!!code) + ', has verifier=' + (!!codeVerifier));

    // Exchange code for tokens via direct HTTP call to Supabase
    var tokenUrl = process.env.SUPABASE_URL + '/auth/v1/token?grant_type=pkce';
    var tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        auth_code: code,
        code_verifier: codeVerifier || '',
      }),
    });

    var tokenData = await tokenResp.json();

    if (!tokenResp.ok || tokenData.error) {
      var errMsg = tokenData.error_description || tokenData.msg || tokenData.error || 'Token exchange failed';
      console.error('Token exchange failed:', errMsg);
      return res.redirect(302, frontendUrl + '/auth?error=token_exchange&detail=' + encodeURIComponent(errMsg) + '&mode=login');
    }

    var userId = tokenData.user.id;
    var email = tokenData.user.email;

    // Fetch or wait for profile
    var profile = null;
    for (var i = 0; i < 3; i++) {
      var result = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
      if (result.data) { profile = result.data; break; }
      await new Promise(function (r) { setTimeout(r, 500); });
    }

    // If no profile exists, create one
    if (!profile) {
      var meta = tokenData.user.user_metadata || {};
      var insertResult = await supabaseAdmin
        .from('profiles')
        .insert({
          id: userId,
          email: email,
          display_name: meta.full_name || meta.name || '',
          role: 'member',
        })
        .select('*')
        .single();
      profile = insertResult.data;
    }

    var user = {
      id: userId,
      email: email,
      name: (profile && (profile.display_name || profile.name)) || (tokenData.user.user_metadata && tokenData.user.user_metadata.name) || '',
      role: (profile && profile.role) || 'member',
      subscription: (profile && (profile.subscription_plan || profile.plan)) || 'free',
    };

    var token = generateToken(user);
    var userJson = encodeURIComponent(JSON.stringify(user));

    // Clear PKCE cookie
    res.setHeader('Set-Cookie', 'pkce_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return res.redirect(302, frontendUrl + '/auth?token=' + token + '&user=' + userJson);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.redirect(302, frontendUrl + '/auth?error=callback_error&detail=' + encodeURIComponent(error.message || 'Unknown') + '&mode=login');
  }
};
