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

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const siteUrl = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
    // Redirect Supabase OAuth back to /auth.html (the frontend page) instead of
    // our backend /api/auth/callback. The Supabase JS client loaded on auth.html
    // picks up the ?code=… query param and runs exchangeCodeForSession() locally,
    // which avoids the cookie-domain / DNS / redirect-chain issues that the
    // server-side callback was hitting in production.
    const redirectTo = `${siteUrl}/auth.html`;

    // Build Supabase OAuth URL — no PKCE / cookies on our side; Supabase JS
    // client on the frontend manages the verifier in localStorage.
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
