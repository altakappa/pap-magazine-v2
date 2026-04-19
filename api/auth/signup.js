/**
 * POST /api/auth/signup
 * Register a new user via Supabase Auth
 */

const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { sendEmail, templates } = require('../_lib/email');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { isValidEmail } = require('../_lib/validate');

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (rateLimit(req, res, RATE_LIMITS.auth)) return;

  let createdUserId = null;

  try {
    const { email, password, name, verifiedToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Verify the email was confirmed via verification code (REQUIRED)
    if (!verifiedToken) {
      return res.status(400).json({ message: 'Email verification is required' });
    }
    try {
      const decoded = jwt.verify(verifiedToken, JWT_SECRET, { algorithms: ['HS256'] });
      if (!decoded.verified || decoded.email !== email.trim().toLowerCase()) {
        return res.status(400).json({ message: 'Email verification mismatch' });
      }
    } catch (err) {
      return res.status(400).json({ message: 'Email verification expired. Please verify again.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || '' },
    });

    if (authError) {
      if (authError.message && (authError.message.includes('already') && authError.message.includes('registered'))) {
        return res.status(409).json({ message: 'Email already registered' });
      }
      throw authError;
    }

    const userId = authData.user.id;
    createdUserId = userId; // Track for rollback on failure

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
    console.error('Signup error:', error.message || error);

    // Rollback: delete the user from Supabase if it was created
    if (createdUserId) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(createdUserId);
        console.log('Rolled back user:', createdUserId);
      } catch (delErr) {
        console.error('Rollback failed:', delErr.message || delErr);
      }
    }

    // Handle "already registered" even when thrown as exception
    if (error.message && (error.message.includes('already') && error.message.includes('registered'))) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    return res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
};
