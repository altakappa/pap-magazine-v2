/**
 * GET /api/auth/facebook
 * Redirect to Supabase Facebook OAuth flow
 */

const { supabase } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const siteUrl = process.env.NEXT_PUBLIC_URL || 'https://www.papkorea.com';
    const redirectTo = `${siteUrl}/api/auth/callback`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: { redirectTo },
    });

    if (error) throw error;

    return res.redirect(302, data.url);
  } catch (error) {
    console.error('Facebook OAuth error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed' });
  }
};
