/**
 * GET  /api/admin/campaigns  — list campaigns (newest first)
 * POST /api/admin/campaigns  — create draft / scheduled campaign
 *
 * Admin-only. Payload shape depends on campaign type:
 *   type='editorial-weekly': payload.editorials = [{ id, slug, title, image, credit, tagline }]
 *   type='news-weekly':      payload.newsItems = [{ title, summary, url, image, category }]
 *
 * The cron at /api/cron/send-due-campaigns picks up rows where
 * status='scheduled' AND scheduled_at <= now() and broadcasts.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

const ALLOWED_TYPES = ['editorial-weekly', 'news-weekly', 'one-off'];
const ALLOWED_STATUS = ['draft', 'scheduled'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    try {
      const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
      const { data, error } = await supabaseAdmin
        .from('email_campaigns')
        .select('id, name, type, subject, status, scheduled_at, sent_at, recipient_count, sent_count, failed_count, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      // Surface live recipient counts (for the "this will send to N people"
      // preview in the admin form) without a separate API call.
      const { count: eligibleCount } = await supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('email_consent', true);

      return res.status(200).json({
        data: data || [],
        eligibleRecipients: eligibleCount || 0,
      });
    } catch (err) {
      console.error('[admin/campaigns GET]', err.message || err);
      return res.status(500).json({ message: 'Failed to load campaigns' });
    }
  }

  if (req.method === 'POST') {
    try {
      const b = req.body || {};
      if (!b.type || !ALLOWED_TYPES.includes(b.type)) {
        return res.status(400).json({ message: 'Invalid campaign type' });
      }
      if (!b.subject || typeof b.subject !== 'string' || !b.subject.trim()) {
        return res.status(400).json({ message: 'Subject is required' });
      }
      const status = ALLOWED_STATUS.includes(b.status) ? b.status : 'draft';
      // Scheduling requires both status='scheduled' AND a future timestamp
      if (status === 'scheduled' && !b.scheduled_at) {
        return res.status(400).json({ message: 'scheduled_at is required when status=scheduled' });
      }
      // Payload sanity: editorial-weekly needs at least 1 editorial,
      // news-weekly needs at least 1 newsItem. Drafts may be empty.
      const payload = b.payload && typeof b.payload === 'object' ? b.payload : {};
      if (status === 'scheduled') {
        if (b.type === 'editorial-weekly' && !(Array.isArray(payload.editorials) && payload.editorials.length)) {
          return res.status(400).json({ message: 'editorial-weekly requires payload.editorials' });
        }
        if (b.type === 'news-weekly' && !(Array.isArray(payload.newsItems) && payload.newsItems.length)) {
          return res.status(400).json({ message: 'news-weekly requires payload.newsItems' });
        }
      }

      const row = {
        name: (b.name || `${b.type}-${new Date().toISOString().slice(0, 10)}`).slice(0, 120),
        type: b.type,
        subject: b.subject.trim(),
        preheader: (b.preheader || '').slice(0, 200) || null,
        hero_headline: (b.hero_headline || '').slice(0, 200) || null,
        hero_body: (b.hero_body || '').slice(0, 2000) || null,
        payload,
        status,
        scheduled_at: b.scheduled_at || null,
        created_by: admin.id || null,
      };

      const { data, error } = await supabaseAdmin
        .from('email_campaigns')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return res.status(201).json({ campaign: data });
    } catch (err) {
      console.error('[admin/campaigns POST]', err.message || err);
      return res.status(500).json({ message: 'Failed to create campaign' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
