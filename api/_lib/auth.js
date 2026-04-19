/**
 * PAP Magazine - Auth Middleware
 * JWT verification and user extraction
 */

const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('./supabase');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Generate JWT token for a user
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
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

module.exports = { generateToken, verifyToken, requireAuth, requireAdmin };
