/**
 * GET /api/auth/google
 * Redirect to Supabase Google OAuth with manual PKCE
 * Generates code_verifier/challenge manually, stores verifier in cookie
 */

const crypto = require('crypto');
const { handleCors } = require('../_lib/cors');

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// Derive the user's current origin from request headers so the OAuth flow
// stays on the same host they started on. Hardcoding NEXT_PUBLIC_URL meant
// users on pap-magazine.com would be redirected to www.pap-magazine.com
// (or vice versa), which dropped the PKCE verifier cookie because cookies
// are scoped to a single host. Vercel sets x-forwarded-* headers.
function getRequestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const siteUrl = getRequestOrigin(req);
    const redirectTo = `${siteUrl}/api/auth/callback`;

    const { verifier, challenge } = generatePKCE();

    // [DIAG-OAUTH] Trace what host the cookie is being scoped to and what
    // redirect_to we hand to Supabase. Compare with callback.js logs to confirm
    // that the same host receives the cookie back.
    console.log('[DIAG-OAUTH google] start', JSON.stringify({
      host: req.headers.host,
      xfh: req.headers['x-forwarded-host'],
      siteUrl: siteUrl,
      redirectTo: redirectTo,
      ua: (req.headers['user-agent'] || '').slice(0, 80),
    }));

    // Store PKCE verifier in cookie for callback to verify
    // NOTE: Do NOT pass a custom `state` parameter — Supabase generates/validates its own state internally.
    // Passing a custom state causes Supabase to return "400: OAuth state parameter is invalid" on callback.
    res.setHeader('Set-Cookie', [
      `pkce_verifier=${verifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    ]);

    // Build Supabase OAuth URL directly (no JS client needed)
    const params = new URLSearchParams({
      provider: 'google',
      redirect_to: redirectTo,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });

    return res.redirect(302, `${supabaseUrl}/auth/v1/authorize?${params}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed' });
  }
};
