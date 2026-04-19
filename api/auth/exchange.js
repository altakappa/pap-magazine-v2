/**
 * POST /api/auth/exchange
 * Exchange a Supabase access_token for a PAP JWT
 * Used after frontend-side OAuth (Google/Facebook) login
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { generateToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { createClient } = require('@supabase/supabase-js');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (rateLimit(req, res, RATE_LIMITS.auth)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    var accessToken = req.body && req.body.access_token;
    if (!accessToken) {
      return res.status(400).json({ message: 'Missing access_token' });
    }

    // Verify the Supabase access token and get user info
    var supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    var { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !userData || !userData.user) {
      return res.status(401).json({ message: 'Invalid access token' });
    }

    var userId = userData.user.id;
    var email = userData.user.email;

    // Fetch profile
    var profile = null;
    var { data } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
    profile = data;

    // If no profile exists, create one
    if (!profile) {
      var meta = userData.user.user_metadata || {};
      var { data: newProfile } = await supabaseAdmin
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

    var user = {
      id: userId,
      email: email,
      name: (profile && (profile.display_name || profile.name)) || (userData.user.user_metadata && userData.user.user_metadata.name) || '',
      role: (profile && profile.role) || 'member',
      subscription: (profile && (profile.subscription_plan || profile.plan)) || 'free',
    };

    var token = generateToken(user);

    return res.status(200).json({ token: token, user: user });
  } catch (error) {
    console.error('Token exchange error:', error);
    return res.status(500).json({ message: 'Exchange failed' });
  }
};
