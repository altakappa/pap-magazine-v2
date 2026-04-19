/**
 * PAP Magazine - CSRF Protection
 * Double-submit cookie pattern for cookie-based authentication
 *
 * How it works:
 * 1. Server sets a random CSRF token in a readable cookie (pap_csrf)
 * 2. Frontend reads the cookie and sends it in X-CSRF-Token header
 * 3. Server compares cookie value with header value
 * 4. Attacker can't read the cookie (different origin), so can't forge the header
 *
 * Only enforced for state-changing methods (POST, PUT, DELETE) when auth is via cookie
 */

const crypto = require('crypto');

/**
 * Generate and set CSRF token cookie (readable by JS, not httpOnly)
 */
function setCsrfCookie(res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const existing = res.getHeader('Set-Cookie') || [];
  const arr = Array.isArray(existing) ? existing : (existing ? [existing] : []);
  arr.push(`pap_csrf=${token}; Path=/; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`);
  res.setHeader('Set-Cookie', arr);
  return token;
}

/**
 * Parse cookies helper
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const parts = c.trim().split('=');
    const key = parts.shift();
    if (key) cookies[key] = parts.join('=');
  });
  return cookies;
}

/**
 * Verify CSRF token for state-changing requests using cookie auth
 * Returns true if CSRF check passes, false if it fails
 * Only enforced when authentication came from cookie (not Authorization header)
 */
function verifyCsrf(req, res) {
  // Only check state-changing methods
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  // Only enforce when using cookie auth (not Authorization header)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return true; // Token in header = not vulnerable to CSRF
  }

  // Check if request is using cookie auth
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.pap_auth) {
    return true; // No cookie auth = no CSRF risk
  }

  // CSRF check: compare cookie token with header token
  const csrfCookie = cookies.pap_csrf;
  const csrfHeader = req.headers['x-csrf-token'];

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    res.status(403).json({ message: 'CSRF validation failed' });
    return false;
  }

  return true;
}

module.exports = { setCsrfCookie, verifyCsrf };
