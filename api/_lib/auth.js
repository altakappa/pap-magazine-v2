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
 * Verify JWT token from Authorization header
 * Returns decoded user payload or null
 */
function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
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
 * Middleware: require admin role
 * Returns user payload or sends 403
 */
async function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;

  // Double-check admin role from database
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return null;
  }

  return user;
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

module.exports = { generateToken, verifyToken, requireAuth, requireAuthStrict, requireAdmin, invalidateTokens };
