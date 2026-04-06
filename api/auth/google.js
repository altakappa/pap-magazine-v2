/**
 * GET /api/auth/google
 * Redirect to Supabase Google OAuth flow
 */

const { supabase } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const redirectTo = `${process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com'}/auth.html`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) throw error;

    // Redirect the user to Google's OAuth consent page
    return res.redirect(302, data.url);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed' });
  }
};
