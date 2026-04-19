/**
 * GET /api/auth/kakao
 * Redirect directly to Kakao OAuth (bypass Supabase to avoid account_email scope)
 */

const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const crypto = require('crypto');
    const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID;
    if (!KAKAO_CLIENT_ID) {
      console.error('KAKAO_CLIENT_ID environment variable is not set');
      return res.status(500).json({ message: 'OAuth configuration error' });
    }
    const siteUrl = process.env.NEXT_PUBLIC_URL || 'https://www.papkorea.com';
    const REDIRECT_URI = `${siteUrl}/api/auth/kakao-callback`;

    // Generate CSRF state parameter
    const state = crypto.randomBytes(32).toString('base64url');
    res.setHeader('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

    const authUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=${state}`;

    return res.redirect(302, authUrl);
  } catch (error) {
    console.error('Kakao OAuth error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed' });
  }
};
