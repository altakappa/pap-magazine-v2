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

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  // NOTE: This server-side endpoint is now a deprecated fallback. The frontend
  // socialLogin() in auth.html now calls supabase.auth.signInWithOAuth() directly,
  // which lets the Supabase JS client manage PKCE in localStorage. Bypassing this
  // endpoint avoids the cross-domain cookie issues we hit when www.pap-magazine.com
  // and www.papkorea.com had different Set-Cookie behaviour during OAuth callback.
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const siteUrl = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
    const redirectTo = `${siteUrl}/auth.html`;

    const params = new URLSearchParams({
      provider: 'google',
      redirect_to: redirectTo,
      access_type: 'offline',
      prompt: 'consent',
    });

    return res.redirect(302, `${supabaseUrl}/auth/v1/authorize?${params}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed' });
  }
};
