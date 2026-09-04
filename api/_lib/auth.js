/**
 * PAP Magazine - Auth Middleware
 * JWT verification with token_version validation
 */

const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('./supabase');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Generate JWT token for a user
 * Includes token_version for server-side invalidation
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tv: user.token_version || 0, // token version for invalidation
    },
    JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
  );
}

/**
 * Parse cookies from request
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
 * Verify JWT token from Authorization header OR httpOnly cookie
 * Priority: Authorization header > pap_auth cookie
 * Returns decoded user payload or null
 */
function verifyToken(req) {
  let token = null;

  // 1. Try Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Fallback to httpOnly cookie
  let fromCookie = false;
  if (!token) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies.pap_auth;
    fromCookie = !!token;
  }

  if (!token) return null;

  /* 2026-09-04 보안감사 (2군 D) — CSRF 2겹째.
     쿠키(pap_auth)는 브라우저가 어느 사이트에서 보낸 요청이든 자동으로 붙인다. 그래서 다른
     사이트가 우리 API 로 POST 를 쏘면 쿠키 인증이 그대로 통과한다(CSRF). 지금까지의 방어는
     쿠키의 SameSite=Lax 하나뿐이었다(api/_lib/csrf.js 의 verifyCsrf 는 어디서도 안 불림).
     Bearer 토큰은 브라우저가 자동으로 붙이지 않으므로 CSRF 와 무관 — 검사하지 않는다.
     규칙: 쿠키로 인증된 상태변경 요청(POST/PUT/DELETE/PATCH)은
       · Origin 헤더가 있으면 허용 목록(cors.js ALLOWED_ORIGINS)에 있어야 하고,
       · Origin 이 없으면 Sec-Fetch-Site 가 'cross-site' 가 아니어야 한다.
     브라우저는 교차 출처 POST 에 Origin 을 반드시 보내므로 CSRF 는 여기서 걸린다.
     서버 간 호출(웹훅·크론)은 Bearer 를 쓰거나 쿠키가 없으므로 영향 없다. */
  if (fromCookie) {
    const m = String(req.method || 'GET').toUpperCase();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      const origin = req.headers.origin;
      const sfs = String(req.headers['sec-fetch-site'] || '').toLowerCase();
      const { ALLOWED_ORIGINS } = require('./cors');
      if (origin) {
        if (!ALLOWED_ORIGINS.includes(origin)) return null;
      } else if (sfs === 'cross-site') {
        return null;
      }
    }
  }

  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
}

/**
 * Set auth cookie on response
 * httpOnly + Secure + SameSite=Lax — safe from XSS, works with same-site navigation
 */
function setAuthCookie(res, token) {
  const maxAge = 7 * 24 * 60 * 60; // 7 days (matches JWT expiry)
  const existingCookies = res.getHeader('Set-Cookie') || [];
  const cookieArr = Array.isArray(existingCookies) ? existingCookies : (existingCookies ? [existingCookies] : []);
  cookieArr.push(`pap_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
  res.setHeader('Set-Cookie', cookieArr);
}

/**
 * Clear auth cookie on response
 */
function clearAuthCookie(res) {
  const existingCookies = res.getHeader('Set-Cookie') || [];
  const cookieArr = Array.isArray(existingCookies) ? existingCookies : (existingCookies ? [existingCookies] : []);
  cookieArr.push('pap_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.setHeader('Set-Cookie', cookieArr);
}

/**
 * Middleware: require authenticated user
 * Validates JWT + checks token_version against DB for critical operations
 * Returns user payload or sends 401
 */
function requireAuth(req, res) {
  const user = verifyToken(req);
  if (!user) {
    res.status(401).json({ message: 'Authentication required' });
    return null;
  }
  return user;
}

/**
 * Middleware: require authenticated user with DB validation
 * Checks token_version to ensure token hasn't been invalidated (e.g., by logout)
 * Use for sensitive operations (profile changes, payments, etc.)
 */
async function requireAuthStrict(req, res) {
  const user = verifyToken(req);
  if (!user) {
    res.status(401).json({ message: 'Authentication required' });
    return null;
  }

  // Verify token version against database
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('token_version, role')
    .eq('id', user.id)
    .single();

  if (!profile) {
    res.status(401).json({ message: 'User not found' });
    return null;
  }

  const dbVersion = profile.token_version || 0;
  const tokenVersion = user.tv || 0;

  if (tokenVersion < dbVersion) {
    res.status(401).json({ message: 'Session expired. Please login again.' });
    return null;
  }

  // Return enriched user with latest role from DB
  return { ...user, role: profile.role };
}

/**
 * Middleware: require admin role (either Main Admin OR Staff).
 *
 * QA #169 — split single admin tier into two:
 *   - 'admin' = 대표 관리자 (main admin, final approval power)
 *   - 'staff' = 서브 관리자 (sub admin, can edit drafts/request revisions)
 *
 * Most editorial CRUD is still allowed for both tiers — only the FINAL
 * approve/reject vote on a submission is gated to main admin via
 * requireMainAdmin below. The returned user payload includes `role` so
 * downstream handlers can branch further if needed.
 *
 * Returns user payload or sends 403.
 */
async function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;

  // Double-check role from database (JWT's role may be stale).
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || (profile.role !== 'admin' && profile.role !== 'staff')) {
    res.status(403).json({ message: 'Admin access required' });
    return null;
  }

  // Surface the fresh role so callers can do their own fine-grained gating
  // (e.g. "only show 회원 관리 to main admin") without a second DB roundtrip.
  return { ...user, role: profile.role };
}

/**
 * Middleware: require MAIN admin role only.
 *
 * Reserved for irreversible / signoff actions:
 *   - Final approve / reject on a submission
 *   - Promoting or demoting other accounts (staff → admin)
 *   - Deleting members
 *
 * Returns user payload or sends 403.
 */
async function requireMainAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    res.status(403).json({ message: 'Main admin access required' });
    return null;
  }

  return { ...user, role: profile.role };
}

/**
 * Increment token_version for a user (invalidates all existing tokens)
 */
async function invalidateTokens(userId) {
  // Try RPC first (atomic increment), fallback to manual
  const { error: rpcError } = await supabaseAdmin.rpc('increment_token_version', { user_id: userId });
  if (rpcError) {
    // Fallback: fetch current version and increment
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('token_version')
      .eq('id', userId)
      .single();
    const currentVersion = (data && data.token_version) || 0;
    await supabaseAdmin
      .from('profiles')
      .update({ token_version: currentVersion + 1 })
      .eq('id', userId);
  }
}

module.exports = { generateToken, verifyToken, requireAuth, requireAuthStrict, requireAdmin, requireMainAdmin, invalidateTokens, setAuthCookie, clearAuthCookie };
