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

  // [DIAG-OAUTH] Temporary diagnostic logging — remove once root cause identified.
  // Inputs we care about for tracing the redirect chain on www.pap-magazine.com.
  var _diagCookies = parseCookies(req.headers.cookie);
  var _diagCookieKeys = Object.keys(_diagCookies);
  console.log('[DIAG-OAUTH callback] enter', JSON.stringify({
    host: req.headers.host,
    xfh: req.headers['x-forwarded-host'],
    xfp: req.headers['x-forwarded-proto'],
    referer: req.headers.referer || null,
    hasCode: !!req.query.code,
    hasError: !!req.query.error,
    errorParam: req.query.error || null,
    cookieKeys: _diagCookieKeys,
    hasPKCE: !!_diagCookies.pkce_verifier,
    pkceLen: _diagCookies.pkce_verifier ? _diagCookies.pkce_verifier.length : 0,
    ua: (req.headers['user-agent'] || '').slice(0, 80),
  }));

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

    // [DIAG-OAUTH] Append host + cookie state to error redirects so we can
    // diagnose without requiring Vercel log access. Compact format.
    function withDiag(url) {
      var diagBits = [
        'h=' + (req.headers.host || '?'),
        'ck=' + _diagCookieKeys.join(',') || 'none',
        'pkce=' + (_diagCookies.pkce_verifier ? 'y' : 'n'),
      ].join('|');
      var sep = url.indexOf('?') > -1 ? '&' : '?';
      return url + sep + 'diag=' + encodeURIComponent(diagBits);
    }

    if (oauthError) {
      console.error('[DIAG-OAUTH callback] provider error', oauthError, errorDesc || '');
      return res.redirect(302, withDiag(withDetail(frontendUrl + '/auth?error=oauth_provider&mode=login', errorDesc || oauthError)));
    }

    if (!code) {
      console.error('[DIAG-OAUTH callback] missing code');
      return res.redirect(302, withDiag(frontendUrl + '/auth?error=missing_code&mode=login'));
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
      console.error('[DIAG-OAUTH callback] missing PKCE verifier — cookies received:', _diagCookieKeys.join(',') || '(none)');
      return res.redirect(302, withDiag(frontendUrl + '/auth?error=missing_verifier&mode=login'));
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
      console.error('[DIAG-OAUTH callback] token exchange failed:', msg);
      return res.redirect(302, withDiag(withDetail(frontendUrl + '/auth?error=token_exchange&mode=login', msg)));
    }
    console.log('[DIAG-OAUTH callback] token exchange OK, user', tokenData.user && tokenData.user.id);

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

    console.log('[DIAG-OAUTH callback] returning success HTML for user', user.id, 'host=', req.headers.host);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
      '<meta name="robots" content="noindex,nofollow">' +
      '<title>로그인 처리 중…</title>' +
      '<style>html,body{margin:0;height:100%;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;flex-direction:column}p{opacity:.7;font-size:14px;margin:4px}small{opacity:.4;font-size:11px}</style>' +
      '</head><body><p>로그인 처리 중…</p><small id="diag"></small>' +
      '<script>(function(){' +
        // [DIAG-OAUTH] Browser-side trace. Visible in DevTools console; also
        // shown faintly under the loading text so the user can copy without DevTools.
        'var diag={step:"start",host:location.host,t:Date.now()};' +
        'function log(m,extra){diag.step=m;if(extra)diag[m]=extra;console.log("[DIAG-OAUTH browser]",m,extra||"");var el=document.getElementById("diag");if(el)el.textContent="diag: "+m;}' +
        'log("entered");' +
        'var setOk=false;' +
        'try{' +
          'var t=' + safeToken + ';' +
          'var u=' + safeUser + ';' +
          'localStorage.setItem("pap-token",t);' +
          'localStorage.setItem("pap-user",JSON.stringify({id:u.id,email:u.email,name:u.name,role:u.role,subscription:u.subscription}));' +
          'setOk=(localStorage.getItem("pap-token")===t);' +
          'log("localStorage_set",{ok:setOk,tokenLen:t.length});' +
        '}catch(e){log("localStorage_error",String(e&&e.message||e));}' +
        // Resolve return URL from cookie set by socialLogin() before the OAuth
        // round-trip; fallback to /mypage.html. NB: this script runs on
        // /api/auth/callback so we must use absolute paths — a relative
        // "mypage.html" would resolve to /api/auth/mypage.html and 404.
        'var dest="/mypage.html";' +
        'try{' +
          'var m=document.cookie.match(/(?:^|; )pap-return-url=([^;]+)/);' +
          'if(m){' +
            'document.cookie="pap-return-url=; Path=/; Max-Age=0; SameSite=Lax";' +
            'var d=decodeURIComponent(m[1]);' +
            'if(d&&d.indexOf("://")===-1&&d.indexOf("//")!==0){' +
              // Force leading slash so the redirect is always site-absolute,
              // regardless of what the cookie stored.
              'dest=d.charAt(0)==="/"?d:"/"+d;' +
            '}' +
          '}' +
        '}catch(e){}' +
        'log("redirecting",dest);' +
        // [DIAG-OAUTH] Small delay so the user can SEE the diag text and we
        // have a window where DevTools shows the console output before the
        // page navigates. Remove once root cause identified.
        'setTimeout(function(){window.location.replace(dest);},500);' +
      '})();<\/script>' +
      '</body></html>'
    );
  } catch (error) {
    console.error('[DIAG-OAUTH callback] uncaught error:', error && (error.message || error.code) || 'UNKNOWN', error && error.stack);
    var detailMsg = error && error.message ? error.message : '';
    var safe = String(detailMsg).replace(/[<>"'`\\\r\n\t]/g, ' ').slice(0, 200);
    var url = frontendUrl + '/auth?error=callback_error&mode=login';
    if (safe) url += '&detail=' + encodeURIComponent(safe);
    return res.redirect(302, withDiag(url));
  }
};
