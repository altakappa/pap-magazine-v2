/**
 * POST /api/admin/campaigns/seed
 *
 * Author-less ingestion endpoint for AI / scheduled-task campaign seeds.
 * The Claude scheduled task `pap-weekly-news` calls this every Sunday
 * morning with a fully built payload (subject, hero copy, newsItems).
 *
 * Auth: Bearer <CRON_SECRET>  — same secret used by /api/cron/send-due-campaigns.
 *
 * Always creates rows in `status='draft'` — the admin reviews and
 * explicitly schedules a send time from the admin UI. We never let
 * the scheduled task push directly to recipients without a human
 * pass-through, which preserves the editorial review step the user
 * asked for.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');

const ALLOWED_TYPES = ['editorial-weekly', 'news-weekly', 'one-off'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Bearer auth (reuses CRON_SECRET so we don't need yet another secret)
  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[seed] CRON_SECRET env not set');
    return res.status(500).json({ message: 'Server misconfiguration (CRON_SECRET missing)' });
  }
  if (got !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const b = req.body || {};
    if (!b.type || !ALLOWED_TYPES.includes(b.type)) {
      return res.status(400).json({ message: 'Invalid campaign type' });
    }
    if (!b.subject || typeof b.subject !== 'string' || !b.subject.trim()) {
      return res.status(400).json({ message: 'subject is required' });
    }

    // Payload sanity per type. We refuse silently-empty drafts because
    // the scheduled task should never succeed when the upstream news
    // search returned nothing — that's a bug to surface, not a row to
    // create.
    const payload = b.payload && typeof b.payload === 'object' ? b.payload : {};
    if (b.type === 'news-weekly' && !(Array.isArray(payload.newsItems) && payload.newsItems.length)) {
      return res.status(400).json({ message: 'news-weekly requires payload.newsItems (non-empty)' });
    }
    if (b.type === 'editorial-weekly' && !(Array.isArray(payload.editorials) && payload.editorials.length)) {
      return res.status(400).json({ message: 'editorial-weekly requires payload.editorials (non-empty)' });
    }

    const row = {
      // Default name to "{type}-YYYY-MM-DD" so the admin lists are
      // chronologically sortable at a glance.
      name: (b.name || `${b.type}-${new Date().toISOString().slice(0, 10)}`).slice(0, 120),
      type: b.type,
      subject: b.subject.trim().slice(0, 200),
      preheader: (b.preheader || '').slice(0, 200) || null,
      hero_headline: (b.hero_headline || '').slice(0, 200) || null,
      hero_body: (b.hero_body || '').slice(0, 2000) || null,
      payload,
      status: 'draft',       // never scheduled directly — admin must approve
      scheduled_at: null,
      created_by: null,      // scheduled-task origin; no human author
    };

    const { data, error } = await supabaseAdmin
      .from('email_campaigns')
      .insert(row)
      .select()
      .single();
    if (error) throw error;

    return res.status(201).json({
      campaign: { id: data.id, name: data.name, status: data.status },
      message: 'Draft created. Review in admin → 이메일 캠페인 → click to schedule.',
    });
  } catch (err) {
    console.error('[seed] error:', err.message || err);
    return res.status(500).json({ message: err.message || 'Failed to seed campaign' });
  }
};
