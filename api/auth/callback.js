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

// Derive the request's actual origin so we redirect the user back to the
// same host they started OAuth on (e.g. pap-magazine.com vs www.pap-magazine.com).
// The /api/auth/google and /api/auth/facebook endpoints already preserve the
// host across the Supabase round-trip, so this callback runs on the original host.
function getRequestOrigin(req) {
  var proto = ((req.headers['x-forwarded-proto'] || 'https') + '').split(',')[0].trim();
  var host = ((req.headers['x-forwarded-host'] || req.headers.host || '') + '').split(',')[0].trim();
  return proto + '://' + host;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  var frontendUrl = getRequestOrigin(req);

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

    // Return an HTML page that embeds the token + user in the BODY, sets
    // localStorage from there, then navigates to mypage.html.
    //
    // Why not URL fragment / query? Cross-site OAuth redirect chains
    // (Google → Supabase → us → /auth#token=...) get their fragments and
    // query params silently stripped by:
    //   - Safari Cross-Site Tracking Prevention (`Prevented ... from accessing
    //     QueryParameters`) — observed in production
    //   - Chrome / Firefox link-decoration / referer-policy variants
    //   - Some intermediate proxies
    // The result was a bare `/auth` URL with no token, even though our callback
    // ran successfully (user rows appearing in Supabase). Returning HTML directly
    // sidesteps all URL-based token transport.
    //
    // Why not Set-Cookie + /api/auth/oauth-token? Set-Cookie on cross-site
    // navigation responses gets dropped by Safari ITP. Verified previously via
    // Vercel logs (callback succeeded, cookie never reached browser).
    //
    // The token is JSON.stringify-escaped before embedding so it's safe to put
    // inside a <script> tag. The user object is similarly serialised.
    //
    // Clear the temporary PKCE/state cookies that /api/auth/google or
    // /api/auth/facebook set at the start of the flow.
    res.setHeader('Set-Cookie', [
      'pkce_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ]);

    // JSON.stringify is the safe way to inline strings/objects into a <script>;
    // additionally escape `</` so a literal `</script` inside any string can't
    // close our tag early.
    var safeToken = JSON.stringify(token).replace(/<\/(script)/gi, '<\\/$1');
    var safeUser  = JSON.stringify(user).replace(/<\/(script)/gi, '<\\/$1');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
      '<meta name="robots" content="noindex,nofollow">' +
      '<title>로그인 처리 중…</title>' +
      '<style>html,body{margin:0;height:100%;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center}p{opacity:.7;font-size:14px}</style>' +
      '</head><body><p>로그인 처리 중…</p>' +
      '<script>(function(){' +
        'try{' +
          'var t=' + safeToken + ';' +
          'var u=' + safeUser + ';' +
          'localStorage.setItem("pap-token",t);' +
          'localStorage.setItem("pap-user",JSON.stringify({id:u.id,email:u.email,name:u.name,role:u.role,subscription:u.subscription}));' +
        '}catch(e){}' +
        // Resolve return URL from cookie set by socialLogin() before the OAuth
        // round-trip; fallback to mypage.html.
        'var dest="mypage.html";' +
        'try{' +
          'var m=document.cookie.match(/(?:^|; )pap-return-url=([^;]+)/);' +
          'if(m){' +
            'document.cookie="pap-return-url=; Path=/; Max-Age=0; SameSite=Lax";' +
            'var d=decodeURIComponent(m[1]);' +
            'if(d&&d.indexOf("://")===-1&&d.indexOf("//")!==0){dest=d;}' +
          '}' +
        '}catch(e){}' +
        'window.location.replace(dest);' +
      '})();<\/script>' +
      '</body></html>'
    );
  } catch (error) {
    console.error('OAuth callback error:', error && (error.message || error.code) || 'UNKNOWN');
    var detailMsg = error && error.message ? error.message : '';
    var safe = String(detailMsg).replace(/[<>"'`\\\r\n\t]/g, ' ').slice(0, 200);
    var url = frontendUrl + '/auth?error=callback_error&mode=login';
    if (safe) url += '&detail=' + encodeURIComponent(safe);
    return res.redirect(302, url);
  }
};
