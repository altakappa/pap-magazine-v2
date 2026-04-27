/**
 * PUT    /api/admin/ads/:id — Update ad
 * DELETE /api/admin/ads/:id — Delete ad
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ message: 'Missing ad id' });

  if (req.method === 'PUT') {
    try {
      let body = req.body;
      if (!body || typeof body === 'string') {
        try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
      }
      // Build a partial update — only set fields that the caller actually sent.
      const update = {};
      if (typeof body.type === 'string') update.type = body.type === 'video' ? 'video' : 'image';
      if (typeof body.src === 'string') update.src = body.src.trim();
      if (typeof body.poster === 'string') update.poster = body.poster.trim() || null;
      if (typeof body.link === 'string') update.link = body.link.trim() || null;
      if (typeof body.brand === 'string') update.brand = body.brand.trim();
      if (Number.isFinite(body.duration)) update.duration = Math.max(1, Math.min(60, parseInt(body.duration)));
      if (Number.isFinite(body.sort_order)) update.sort_order = parseInt(body.sort_order);
      if (typeof body.active === 'boolean') update.active = body.active;

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ message: 'Nothing to update' });
      }
      // Required-field guards (only if the caller is trying to clear them)
      if (update.src === '') return res.status(400).json({ message: 'src cannot be empty' });
      if (update.brand === '') return res.status(400).json({ message: 'brand cannot be empty' });

      const { data, error } = await supabaseAdmin
        .from('interstitial_ads')
        .update(update)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      if (!data) return res.status(404).json({ message: 'Ad not found' });
      return res.status(200).json({ ad: data });
    } catch (err) {
      console.error('[admin/ads PUT] error:', err);
      return res.status(500).json({ message: 'Failed to update ad', detail: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { error } = await supabaseAdmin
        .from('interstitial_ads')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin/ads DELETE] error:', err);
      return res.status(500).json({ message: 'Failed to delete ad', detail: err.message });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
