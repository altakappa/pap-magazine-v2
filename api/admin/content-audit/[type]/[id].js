/**
 * GET /api/admin/content-audit/:type/:id
 *
 * QA #202 — paginated audit history for a single content row, used
 * by the admin editor's "수정 이력" panel. Returns the last N entries
 * sorted newest-first, joined with the actor's profile so the UI can
 * render "도메니코 · 2시간 전" rows without a second round-trip.
 *
 * The endpoint is admin-only — the audit ledger contains diff payloads
 * for unpublished work, so it must not be reachable by anonymous reads.
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { handleCors } = require('../../../_lib/cors');
const { requireAdmin } = require('../../../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');

const VALID_TYPES = new Set(['editorial','article','film','shorts']);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { type, id } = req.query;
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'invalid content type', got: type });
  }
  if (!id) {
    return res.status(400).json({ error: 'content id is required' });
  }

  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const { data, error } = await supabaseAdmin
      .from('content_audit_log')
      .select('id, content_type, content_id, action, actor_id, actor_label, summary, diff, created_at')
      .eq('content_type', type)
      .eq('content_id', id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return res.status(200).json({ data: data || [], count: (data || []).length });
  } catch (err) {
    console.error('[content-audit GET] error:', err && err.message);
    return res.status(500).json({ error: 'Failed to fetch audit log', detail: err && err.message });
  }
};
