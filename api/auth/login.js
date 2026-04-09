/**
 * POST /api/auth/login
 * Authenticate user with email/password via Supabase Auth
 */

const { supabase, supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (rateLimit(req, res, RATE_LIMITS.auth)) return;

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Authenticate via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      // Try to distinguish error types for better UX
      var errMsg = authError.message || '';
      if (errMsg.includes('Invalid login credentials')) {
        // Check if user exists to provide specific feedback
        var { data: existingUser } = await supabaseAdmin.auth.admin.listUsers({ filter: { email: email } });
        var userExists = existingUser && existingUser.users && existingUser.users.length > 0;
        if (!userExists) {
          return res.status(401).json({ message: 'User not found', code: 'USER_NOT_FOUND' });
        }
        return res.status(401).json({ message: 'Invalid password', code: 'WRONG_PASSWORD' });
      }
      return res.status(401).json({ message: 'Invalid email or password', code: 'AUTH_ERROR' });
    }

    const userId = authData.user.id;

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const user = {
      id: userId,
      email: profile?.email || email,
      name: profile?.display_name || profile?.name || '',
      role: profile?.role || 'member',
      subscription: profile?.subscription_plan || profile?.plan || 'free',
    };

    const token = generateToken(user);

    return res.status(200).json({ token, user });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Login failed. Please try again.' });
  }
};
