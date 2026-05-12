/**
 * GET    /api/admin/campaigns/:id         — single campaign + per-recipient log preview
 * PUT    /api/admin/campaigns/:id         — edit subject / payload / schedule
 * DELETE /api/admin/campaigns/:id         — only allowed while status='draft' or 'scheduled'
 *
 * Admin-only. Once a campaign has been sent ('sending' / 'sent' / 'failed'),
 * the API blocks edits and deletes — historical campaigns are an audit
 * trail you can't tamper with.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

const EDITABLE_STATUSES = ['draft', 'scheduled'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ message: 'id is required' });

  if (req.method === 'GET') {
    try {
      const { data: campaign, error } = await supabaseAdmin
        .from('email_campaigns').select('*').eq('id', id).single();
      if (error) throw error;

      // Per-recipient counts so the admin can see who bounced.
      const { data: logSummary } = await supabaseAdmin
        .from('email_log')
        .select('status', { count: 'exact' })
        .eq('campaign_id', id);
      const stats = (logSummary || []).reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});
      return res.status(200).json({ campaign, stats });
    } catch (err) {
      console.error('[admin/campaigns/:id GET]', err.message || err);
      return res.status(500).json({ message: 'Failed to load campaign' });
    }
  }

  if (req.method === 'PUT') {
    try {
      // Block edits on already-broadcast campaigns.
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('email_campaigns').select('status').eq('id', id).single();
      if (exErr) throw exErr;
      if (!EDITABLE_STATUSES.includes(existing.status)) {
        return res.status(409).json({ message: 'Campaign already sent — cannot edit' });
      }

      const b = req.body || {};
      const patch = { updated_at: new Date().toISOString() };
      if (typeof b.subject === 'string')        patch.subject = b.subject.trim();
      if (typeof b.preheader === 'string')      patch.preheader = b.preheader.slice(0, 200) || null;
      if (typeof b.hero_headline === 'string')  patch.hero_headline = b.hero_headline.slice(0, 200) || null;
      if (typeof b.hero_body === 'string')      patch.hero_body = b.hero_body.slice(0, 2000) || null;
      if (b.payload && typeof b.payload === 'object') patch.payload = b.payload;
      if (typeof b.scheduled_at !== 'undefined') patch.scheduled_at = b.scheduled_at || null;
      if (typeof b.status === 'string' && EDITABLE_STATUSES.includes(b.status)) patch.status = b.status;
      if (typeof b.name === 'string')           patch.name = b.name.slice(0, 120);

      // Promoting to 'scheduled' requires a future scheduled_at.
      if (patch.status === 'scheduled' && !patch.scheduled_at && !b.scheduled_at) {
        return res.status(400).json({ message: 'scheduled_at required when status=scheduled' });
      }

      const { data, error } = await supabaseAdmin
        .from('email_campaigns').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json({ campaign: data });
    } catch (err) {
      console.error('[admin/campaigns/:id PUT]', err.message || err);
      return res.status(500).json({ message: 'Failed to update campaign' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('email_campaigns').select('status').eq('id', id).single();
      if (exErr) throw exErr;
      if (!EDITABLE_STATUSES.includes(existing.status)) {
        return res.status(409).json({ message: 'Campaign already sent — cannot delete' });
      }
      const { error } = await supabaseAdmin
        .from('email_campaigns').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin/campaigns/:id DELETE]', err.message || err);
      return res.status(500).json({ message: 'Failed to delete campaign' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
