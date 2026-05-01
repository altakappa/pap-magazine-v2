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

  var frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

  try {
    var code = req.query.code;
    var oauthError = req.query.error;
    var errorDesc = req.query.error_description;

    // Helper — append a (sanitized, length-capped) detail string to the redirect URL
    // so the frontend can show the user what actually went wrong. We strip anything
    // that could break out of the query-string and cap to 200 chars to keep URLs sane.
    function withDetail(baseUrl, raw) {
      if (!raw) return baseUrl;
      var safe = String(raw).replace(/[<>"'`\\\r\n\t]/g, ' ').slice(0, 200);
      return baseUrl + '&detail=' + encodeURIComponent(safe);
    }

    if (oauthError) {
      console.error('OAuth error from provider:', oauthError, errorDesc || '');
      return res.redirect(302, withDetail(frontendUrl + '/auth?error=oauth_provider&mode=login', errorDesc || oauthError));
    }

    if (!code) {
      return res.redirect(302, frontendUrl + '/auth?error=missing_code&mode=login');
    }

    // Read cookies
    var cookies = parseCookies(req.headers.cookie);
    var codeVerifier = cookies.pkce_verifier;

    // NOTE: We do NOT validate a custom `state` parameter here —
    // Supabase generates and validates its own OAuth state internally. Passing a custom state
    // caused "400: OAuth state parameter is invalid" errors on Supabase's /callback endpoint.
    // PKCE code_verifier below provides protection against code interception attacks.

    // PKCE verifier is required — reject if missing (prevents code interception attacks)
    if (!codeVerifier) {
      console.error('OAuth callback missing PKCE code_verifier');
      return res.redirect(302, frontendUrl + '/auth?error=missing_verifier&mode=login');
    }

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
        code_verifier: codeVerifier,
      }),
    });

    var tokenData = await tokenResp.json();

    if (!tokenResp.ok || tokenData.error) {
      var msg = tokenData.error_description || tokenData.error || ('HTTP ' + tokenResp.status);
      console.error('Token exchange failed:', msg);
      return res.redirect(302, withDetail(frontendUrl + '/auth?error=token_exchange&mode=login', msg));
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
      token_version: (profile && profile.token_version) || 0,
    };

    var token = generateToken(user);
    var userJson = encodeURIComponent(JSON.stringify(user));

    // Pass token directly in the URL fragment instead of via HttpOnly cookies.
    //
    // Why: the cookie-based flow (Set-Cookie + /auth?oauth=success → frontend
    // calls /api/auth/oauth-token to read it) was failing on www.pap-magazine.com
    // because Safari ITP / cross-site OAuth redirect chains were dropping the
    // Set-Cookie response. Verified via Vercel function logs: callback ran all
    // 8 steps successfully, but no cookies appeared in browser storage and the
    // /api/auth/oauth-token endpoint was never invoked.
    //
    // Fragment vs query: a URL fragment (#) is NOT sent to servers, so it
    // avoids referrer / access-log token leakage. The auth.html handler reads
    // either query (?token=) or fragment (#token=) and immediately strips it
    // from history with replaceState.
    //
    // Clear the temporary PKCE/state cookies that /api/auth/google or
    // /api/auth/facebook set at the start of the flow.
    res.setHeader('Set-Cookie', [
      'pkce_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ]);
    var successUrl = frontendUrl + '/auth#token=' + encodeURIComponent(token) +
      '&user=' + userJson;
    return res.redirect(302, successUrl);
  } catch (error) {
    console.error('OAuth callback error:', error && (error.message || error.code) || 'UNKNOWN');
    var detailMsg = error && error.message ? error.message : '';
    var safe = String(detailMsg).replace(/[<>"'`\\\r\n\t]/g, ' ').slice(0, 200);
    var url = frontendUrl + '/auth?error=callback_error&mode=login';
    if (safe) url += '&detail=' + encodeURIComponent(safe);
    return res.redirect(302, url);
  }
};
