/**
 * POST /api/auth/signup
 * Register a new user via Supabase Auth
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { sendEmail, templates } = require('../_lib/email');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { isValidEmail } = require('../_lib/validate');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (rateLimit(req, res, RATE_LIMITS.auth)) return;

  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm for now; enable email verification later
      user_metadata: { name: name || '' },
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        return res.status(409).json({ message: 'Email already registered' });
      }
      throw authError;
    }

    const userId = authData.user.id;

    // Profile is auto-created by the database trigger (handle_new_user)
    // But let's ensure it exists and fetch it
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const user = {
      id: userId,
      email,
      name: name || '',
      role: profile?.role || 'member',
      subscription: profile?.subscription_plan || 'free',
    };

    const token = generateToken(user);

    // Send welcome email (non-blocking)
    sendEmail(email, templates.welcome(user)).catch(() => {});

    return res.status(201).json({ token, user });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
};
