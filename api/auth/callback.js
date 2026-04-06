/**
 * GET /api/auth/callback
 * Handle OAuth callback from Supabase
 * Exchanges the auth code for a session, generates JWT, and redirects to frontend
 */

const { supabase, supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { code } = req.query;

    if (!code) {
      return res.redirect(302, `${process.env.NEXT_PUBLIC_URL}/auth.html?error=missing_code`);
    }

    // Exchange code for session
    const { data: authData, error: authError } = await supabase.auth.exchangeCodeForSession(code);

    if (authError) throw authError;

    const userId = authData.user.id;
    const email = authData.user.email;

    // Fetch or wait for profile (trigger may take a moment)
    let profile;
    for (let i = 0; i < 3; i++) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (data) { profile = data; break; }
      await new Promise(r => setTimeout(r, 500));
    }

    const user = {
      id: userId,
      email,
      name: profile?.name || authData.user.user_metadata?.name || '',
      role: profile?.role || 'member',
      subscription: profile?.subscription_plan || 'free',
    };

    const token = generateToken(user);
    const frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

    return res.redirect(302, `${frontendUrl}/auth.html?token=${token}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
    return res.redirect(302, `${frontendUrl}/auth.html?error=auth_failed`);
  }
};
