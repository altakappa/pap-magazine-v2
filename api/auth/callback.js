/**
 * GET /api/auth/callback
 * Handle OAuth callback from Supabase
 * Exchanges the auth code for a session, generates JWT, and redirects to frontend
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const frontendUrl = process.env.NEXT_PUBLIC_URL || 'https://www.papkorea.com';

  try {
    const { code, error: oauthError, error_description } = req.query;

    if (oauthError) {
      console.error('OAuth error from provider:', oauthError, error_description);
      return res.redirect(302, `${frontendUrl}/auth.html?error=auth_failed&detail=${encodeURIComponent(error_description || oauthError)}&mode=login`);
    }

    if (!code) {
      return res.redirect(302, `${frontendUrl}/auth.html?error=missing_code&mode=login`);
    }

    // Exchange code for session using admin client
    const { data: authData, error: authError } = await supabaseAdmin.auth.exchangeCodeForSession(code);

    if (authError) {
      console.error('Code exchange error:', authError);
      return res.redirect(302, `${frontendUrl}/auth.html?error=auth_failed&detail=${encodeURIComponent(authError.message)}&mode=login`);
    }

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

    // If no profile exists yet, create one
    if (!profile) {
      const meta = authData.user.user_metadata || {};
      const { data: newProfile } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: userId,
          email: email,
          display_name: meta.full_name || meta.name || '',
          role: 'member',
        })
        .select('*')
        .single();
      profile = newProfile;
    }

    const user = {
      id: userId,
      email,
      name: profile?.display_name || profile?.name || authData.user.user_metadata?.name || '',
      role: profile?.role || 'member',
      subscription: profile?.subscription_plan || profile?.plan || 'free',
    };

    const token = generateToken(user);
    const userJson = encodeURIComponent(JSON.stringify(user));

    return res.redirect(302, `${frontendUrl}/auth.html?token=${token}&user=${userJson}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.redirect(302, `${frontendUrl}/auth.html?error=auth_failed&detail=${encodeURIComponent(error.message || 'Unknown')}&mode=login`);
  }
};
