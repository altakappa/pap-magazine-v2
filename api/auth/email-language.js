/**
 * PUT /api/auth/email-language
 *
 * Body: { lang: 'ko' | 'en' | 'it' | 'fr' | 'es' | 'ja' | 'zh' | 'ru' | 'de' }
 *
 * Persists the caller's preferred NEWSLETTER language onto
 * profiles.email_language. Intentionally separate from
 * profiles.language (site UI) so a user can read the site in one
 * language and receive marketing email in another (e.g. KR-based
 * designer who forwards newsletters to international collaborators).
 *
 * Called by mypage.html#updateEmailLanguage when the user picks a
 * value in the "이메일 수신 언어" dropdown.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const SUPPORTED_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  const wanted = body.lang;
  if (!wanted || typeof wanted !== 'string') {
    return res.status(400).json({ message: 'lang is required' });
  }
  const safe = SUPPORTED_LANGS.includes(wanted) ? wanted : 'en';

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ email_language: safe })
      .eq('id', user.id);
    if (error) throw error;
    return res.status(200).json({ email_language: safe });
  } catch (err) {
    console.error('[auth/email-language] error:', err.message || err);
    return res.status(500).json({ message: 'Failed to save email language' });
  }
};
