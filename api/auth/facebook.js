/**
 * GET /api/auth/facebook
 * Redirect to Supabase Facebook OAuth with manual PKCE
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

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const siteUrl = process.env.NEXT_PUBLIC_URL || 'https://www.papkorea.com';
    const redirectTo = `${siteUrl}/api/auth/callback`;

    const { verifier, challenge } = generatePKCE();

    // Generate CSRF state parameter
    const state = base64url(crypto.randomBytes(32));

    // Store verifier and state in cookies for callback to verify
    res.setHeader('Set-Cookie', [
      `pkce_verifier=${verifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    ]);

    // Build Supabase OAuth URL directly (no JS client needed)
    const params = new URLSearchParams({
      provider: 'facebook',
      redirect_to: redirectTo,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    return res.redirect(302, `${supabaseUrl}/auth/v1/authorize?${params}`);
  } catch (error) {
    console.error('Facebook OAuth error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed' });
  }
};
