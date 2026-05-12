/**
 * GET  /api/auth/consent  — return the caller's current consent state
 * PUT  /api/auth/consent  — update marketing / email opt-in flags
 *
 * Only the OPTIONAL consents (marketing, email) are mutable here. The
 * three required signup consents (terms, privacy, age) are immutable
 * after account creation — to revoke them the user must close their
 * account, which is a separate (heavier) flow.
 *
 * Every change appends to public.consent_history with the originating
 * IP + UA so the audit trail can answer "show me proof user X granted
 * email consent on YYYY-MM-DD" later.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const MUTABLE_TYPES = ['marketing', 'email'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = requireAuth(req, res);
  if (!user) return; // requireAuth already wrote 401

  // ── GET ───────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('terms_consent_at, privacy_consent_at, age_consent_at, marketing_consent, marketing_consent_at, email_consent, email_consent_at')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return res.status(200).json({
        consent: data || {},
      });
    } catch (err) {
      console.error('[consent GET] error:', err.message || err);
      return res.status(500).json({ message: 'Failed to load consent state' });
    }
  }

  // ── PUT ───────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    try {
      const body = req.body || {};
      // Accept either { marketing: bool, email: bool } directly or the
      // signup-style { marketing, emailNotification } shape for symmetry
      // with /api/auth/signup. Coerce explicitly to booleans so passing
      // "false" (string) doesn't get treated as truthy.
      const updates = {};
      if (typeof body.marketing !== 'undefined') {
        updates.marketing = body.marketing === true || body.marketing === 'true';
      }
      if (typeof body.email !== 'undefined') {
        updates.email = body.email === true || body.email === 'true';
      } else if (typeof body.emailNotification !== 'undefined') {
        updates.email = body.emailNotification === true || body.emailNotification === 'true';
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: 'No mutable consent fields provided' });
      }

      // Pull the current row so history only records actual transitions
      // — toggling marketing OFF when it's already OFF is a no-op, and
      // we don't want the audit log polluted with phantom entries.
      const { data: current, error: curErr } = await supabaseAdmin
        .from('profiles')
        .select('marketing_consent, email_consent')
        .eq('id', user.id)
        .single();
      if (curErr) throw curErr;

      const nowIso = new Date().toISOString();
      const profilePatch = {};
      const historyRows = [];
      const ipAddr = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
        .split(',')[0].trim() || null;
      const userAgent = (req.headers['user-agent'] || '').slice(0, 500) || null;

      for (const type of MUTABLE_TYPES) {
        if (typeof updates[type] === 'undefined') continue;
        const want = updates[type];
        const has = !!current[type + '_consent'];
        if (want === has) continue; // no-op
        profilePatch[type + '_consent'] = want;
        profilePatch[type + '_consent_at'] = want ? nowIso : null;
        historyRows.push({
          user_id: user.id,
          consent_type: type,
          granted: want,
          source: 'mypage',
          ip_address: ipAddr,
          user_agent: userAgent,
        });
      }

      if (Object.keys(profilePatch).length === 0) {
        // Nothing actually changed — return current state.
        return res.status(200).json({ consent: current, changed: false });
      }

      const { error: upErr } = await supabaseAdmin
        .from('profiles')
        .update(profilePatch)
        .eq('id', user.id);
      if (upErr) throw upErr;

      // Best-effort history insert; never block the response.
      supabaseAdmin.from('consent_history').insert(historyRows)
        .then(({ error }) => { if (error) console.error('[consent PUT] history insert:', error.message || error); })
        .catch(err => console.error('[consent PUT] history threw:', err.message || err));

      return res.status(200).json({
        consent: { ...current, ...profilePatch },
        changed: true,
      });
    } catch (err) {
      console.error('[consent PUT] error:', err.message || err);
      return res.status(500).json({ message: 'Failed to update consent' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
