/**
 * POST /api/auth/signup
 * Register a new user via Supabase Auth
 */

const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken, setAuthCookie } = require('../_lib/auth');
const { setCsrfCookie } = require('../_lib/csrf');
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
    const { email, password, name, verifiedToken, consent } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Consent payload arrives from auth.html#completeSignup as
    // { terms, privacy, age, marketing, emailNotification }.
    // The three required ones MUST be true — if the client somehow
    // skipped the consent UI validation, fail here so we never create
    // an account without legal basis. Marketing / email are optional.
    const consentObj = consent && typeof consent === 'object' ? consent : {};
    if (!consentObj.terms || !consentObj.privacy || !consentObj.age) {
      return res.status(400).json({
        message: 'Required consents (terms, privacy, age) must be accepted',
      });
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

    // Password policy: min 8 chars, must contain letter + number
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ message: 'Password must contain at least one letter and one number' });
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
    // — write the consent decisions onto that row. Best-effort: the
    // trigger may not have committed yet on slow databases, so use
    // upsert keyed by id. We do NOT let consent-write failure roll
    // back the user (the account is still valid; consent can be set
    // later from mypage), but we log so it shows up in Vercel logs.
    const nowIso = new Date().toISOString();
    const ipAddr = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
      .split(',')[0].trim() || null;
    const userAgent = (req.headers['user-agent'] || '').slice(0, 500) || null;

    try {
      await supabaseAdmin
        .from('profiles')
        .upsert({
          id: userId,
          email,
          terms_consent_at: nowIso,
          privacy_consent_at: nowIso,
          age_consent_at: nowIso,
          marketing_consent: !!consentObj.marketing,
          marketing_consent_at: consentObj.marketing ? nowIso : null,
          email_consent: !!consentObj.emailNotification,
          email_consent_at: consentObj.emailNotification ? nowIso : null,
        }, { onConflict: 'id' });
    } catch (consentErr) {
      console.error('[signup] failed to persist consent:', consentErr.message || consentErr);
    }

    // Append-only audit trail. One row per consent type so regulators
    // can reconstruct exactly which clauses were accepted. Fire-and-
    // forget — never block the signup response on this.
    const historyRows = [
      { user_id: userId, consent_type: 'terms',     granted: true,                                  source: 'signup', ip_address: ipAddr, user_agent: userAgent },
      { user_id: userId, consent_type: 'privacy',   granted: true,                                  source: 'signup', ip_address: ipAddr, user_agent: userAgent },
      { user_id: userId, consent_type: 'age',       granted: true,                                  source: 'signup', ip_address: ipAddr, user_agent: userAgent },
      { user_id: userId, consent_type: 'marketing', granted: !!consentObj.marketing,                source: 'signup', ip_address: ipAddr, user_agent: userAgent },
      { user_id: userId, consent_type: 'email',     granted: !!consentObj.emailNotification,        source: 'signup', ip_address: ipAddr, user_agent: userAgent },
    ];
    supabaseAdmin.from('consent_history').insert(historyRows)
      .then(({ error }) => { if (error) console.error('[signup] consent_history insert:', error.message || error); })
      .catch(err => console.error('[signup] consent_history insert threw:', err.message || err));

    // Re-fetch the profile so the response carries the freshly-saved
    // consent state (the trigger-created row + our upsert).
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
      token_version: profile?.token_version || 0,
    };

    const token = generateToken(user);

    // Set httpOnly auth cookie (XSS-safe) + CSRF token
    setAuthCookie(res, token);
    setCsrfCookie(res);

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
