/**
 * POST /api/auth/logout
 * Invalidate all tokens for the current user by incrementing token_version
 */

const { requireAuth, invalidateTokens, clearAuthCookie } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (rateLimit(req, res, RATE_LIMITS.auth)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    // Increment token_version → all existing JWTs for this user become invalid
    await invalidateTokens(user.id);

    // Clear auth cookie + OAuth cookies
    clearAuthCookie(res);
    const existing = res.getHeader('Set-Cookie') || [];
    const arr = Array.isArray(existing) ? existing : [existing];
    arr.push('pap_oauth_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    arr.push('pap_oauth_user=; Path=/; SameSite=Lax; Max-Age=0');
    res.setHeader('Set-Cookie', arr);

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error.code || 'UNKNOWN');
    return res.status(500).json({ message: 'Logout failed' });
  }
};
