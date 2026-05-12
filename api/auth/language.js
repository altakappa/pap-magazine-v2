/**
 * PUT /api/auth/language
 *
 * Body: { lang: 'ko' | 'en' | 'it' | 'fr' | 'es' | 'ja' | 'zh' | 'ru' | 'de' }
 *
 * Persists the caller's preferred site language onto profiles.language
 * so the campaign cron can render newsletters in the right locale.
 * Called by pap-i18n.js#setLang whenever a logged-in member changes
 * the language dropdown — fire-and-forget on the client side.
 *
 * Fails silently with 'en' if the requested language isn't in our
 * supported list, mirroring the same sanitization signup.js does.
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
      .update({ language: safe })
      .eq('id', user.id);
    if (error) throw error;
    return res.status(200).json({ language: safe });
  } catch (err) {
    console.error('[auth/language] error:', err.message || err);
    return res.status(500).json({ message: 'Failed to save language' });
  }
};
