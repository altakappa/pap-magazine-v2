/**
 * GET /api/submissions/:id — Get a single submission by ID
 *
 * Authorization: the caller must either own the submission, or be an
 * admin (role checked against `profiles.role`, NOT against the JWT, since the
 * JWT may have been issued before the role was promoted).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ message: 'Missing submission id' });
    }

    const { data: submission, error } = await supabaseAdmin
      .from('submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Owner can always view their own. For non-owners, check admin role
    // against the database (JWT's role may be stale).
    const isOwner = submission.user_id === user.id;
    let isAdmin = false;
    if (!isOwner) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      isAdmin = !!(prof && prof.role === 'admin');
    }
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Enrich with submitter profile + active subscription plan so the admin
    // review modal has every field it needs in one round trip. Mirrors the
    // shape returned by the list endpoint.
    let submitterName = null;
    let submitterEmail = null;
    let submitterPlan = null;
    if (submission.user_id) {
      const [profRes, subRes] = await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('display_name, email')
          .eq('id', submission.user_id)
          .single(),
        supabaseAdmin
          .from('subscriptions')
          .select('plan, status')
          .eq('user_id', submission.user_id),
      ]);
      if (profRes && profRes.data) {
        submitterName = profRes.data.display_name || null;
        submitterEmail = profRes.data.email || null;
      }
      if (subRes && Array.isArray(subRes.data) && subRes.data.length > 0) {
        const active = subRes.data.find(s => s.status === 'active');
        submitterPlan = (active || subRes.data[0]).plan || null;
      }
    }

    return res.status(200).json({
      submission: {
        ...submission,
        submitterName,
        submitterEmail,
        submitterPlan,
      },
    });
  } catch (error) {
    try {
      console.error('Get submission error:', {
        name: error && error.name,
        message: error && error.message,
        code: error && error.code,
        details: error && error.details,
        hint: error && error.hint,
      });
    } catch (_) { console.error('Get submission error (raw):', error); }

    const parts = [];
    if (error && error.message) parts.push(String(error.message));
    if (error && error.code) parts.push('code=' + error.code);
    const hint = parts.join(' | ').slice(0, 300);
    return res.status(500).json({
      message: 'Failed to fetch submission' + (hint ? ` — ${hint}` : ''),
    });
  }
};
