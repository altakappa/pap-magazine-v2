/**
 * GET /api/auth/kakao
 * Redirect to Supabase Kakao OAuth flow (without account_email scope)
 */

const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://igcazquhkwxtqsaqpznx.supabase.co';
    const redirectTo = encodeURIComponent('https://www.papkorea.com/api/auth/callback');
    const scopes = encodeURIComponent('profile_nickname profile_image');

    const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=kakao&redirect_to=${redirectTo}&scopes=${scopes}`;

    return res.redirect(302, authUrl);
  } catch (error) {
    console.error('Kakao OAuth error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed' });
  }
};
