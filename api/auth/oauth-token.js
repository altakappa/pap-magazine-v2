/**
 * POST /api/auth/oauth-token
 * Exchange OAuth httpOnly cookie for token response
 * This prevents token leakage via URL parameters
 */

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

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.pap_oauth_token;
    const userJson = cookies.pap_oauth_user;

    if (!token) {
      return res.status(400).json({ message: 'No OAuth token found' });
    }

    // Clear the one-time-use cookies immediately
    res.setHeader('Set-Cookie', [
      'pap_oauth_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'pap_oauth_user=; Path=/; SameSite=Lax; Max-Age=0',
    ]);

    let user = null;
    if (userJson) {
      try {
        user = JSON.parse(decodeURIComponent(userJson));
      } catch (e) {
        // ignore parse errors
      }
    }

    return res.status(200).json({ token, user });
  } catch (error) {
    console.error('OAuth token exchange error:', error.code || 'UNKNOWN');
    return res.status(500).json({ message: 'Token exchange failed' });
  }
};
