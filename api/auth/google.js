/**
 * GET /api/auth/google
 * Redirect to Supabase Google OAuth flow
 * Stores PKCE code_verifier in a cookie so callback.js can use it
 */

const { createClient } = require('@supabase/supabase-js');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const siteUrl = process.env.NEXT_PUBLIC_URL || 'https://www.papkorea.com';
    const redirectTo = `${siteUrl}/api/auth/callback`;

    // Custom storage to capture PKCE code_verifier
    let codeVerifier = null;
    const storage = {
      getItem: () => null,
      setItem: (key, value) => { if (key.includes('code-verifier')) codeVerifier = value; },
      removeItem: () => {},
    };

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { flowType: 'pkce', storage, autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
    );

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });

    if (error) throw error;

    // Pass code_verifier to callback via secure cookie
    const cookieOptions = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600';
    if (codeVerifier) {
      res.setHeader('Set-Cookie', `pkce_verifier=${codeVerifier}; ${cookieOptions}`);
    }

    return res.redirect(302, data.url);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return res.status(500).json({ message: 'OAuth initialization failed', detail: error.message });
  }
};
