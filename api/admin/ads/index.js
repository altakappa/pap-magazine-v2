/**
 * GET  /api/admin/ads — List all interstitial ads (admin)
 * POST /api/admin/ads — Create new ad (admin)
 *
 * Public-facing version is /api/ads (which only returns active ads).
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

function _validateAdBody(body) {
  const errors = [];
  const type = body.type === 'video' ? 'video' : 'image';
  const src = typeof body.src === 'string' ? body.src.trim() : '';
  const poster = typeof body.poster === 'string' ? body.poster.trim() : '';
  const link = typeof body.link === 'string' ? body.link.trim() : '';
  const brand = typeof body.brand === 'string' ? body.brand.trim() : '';
  const duration = Number.isFinite(body.duration) ? Math.max(1, Math.min(60, parseInt(body.duration))) : 3;
  const sort_order = Number.isFinite(body.sort_order) ? parseInt(body.sort_order) : 0;
  const active = body.active !== false;

  if (!src) errors.push('src (creative URL) is required');
  if (!brand) errors.push('brand is required');

  return {
    valid: errors.length === 0,
    errors,
    payload: { type, src, poster: poster || null, link: link || null, brand, duration, sort_order, active },
  };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  // ── GET: List all ads (admin) ──
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('interstitial_ads')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ ads: data || [] });
    } catch (err) {
      console.error('[admin/ads] list error:', err);
      return res.status(500).json({ message: 'Failed to list ads', detail: err.message });
    }
  }

  // ── POST: Create new ad ──
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (!body || typeof body === 'string') {
        try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
      }
      const v = _validateAdBody(body);
      if (!v.valid) return res.status(400).json({ message: v.errors.join(', ') });

      const { data, error } = await supabaseAdmin
        .from('interstitial_ads')
        .insert(v.payload)
        .select()
        .single();
      if (error) throw error;
      return res.status(201).json({ ad: data });
    } catch (err) {
      console.error('[admin/ads] create error:', err);
      return res.status(500).json({ message: 'Failed to create ad', detail: err.message });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};

module.exports._validateAdBody = _validateAdBody;
