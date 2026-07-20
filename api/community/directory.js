/**
 * GET /api/community/directory — Search creative directory (?role=&q=&page=)
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
    const { role, q, page = 1 } = req.query;
    const perPage = 24;
    const offset = (parseInt(page) - 1) * perPage;

    // Directory is based on profiles with public info
    let query = supabaseAdmin
      .from('profiles')
      // 2026-07-20 — subscription_plan 제거: 로그인만 하면(무료 포함) 누가 유료회원인지
      // 열거할 수 있던 등급 노출을 차단(응답에서도 plan 미포함).
      .select('id, name, avatar_url, bio, location, instagram, website', { count: 'exact' })
      .not('name', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    // Sanitize input for ilike queries (prevent SQL injection via special chars)
    function sanitizeLike(str) {
      return str.replace(/[%_\\]/g, '\\$&').slice(0, 100);
    }

    // Filter by role/profession if stored in bio
    if (role && role !== 'all') {
      const safeRole = sanitizeLike(role);
      query = query.ilike('bio', `%${safeRole}%`);
    }

    // Text search
    if (q) {
      const safeQ = sanitizeLike(q);
      query = query.or(`name.ilike.%${safeQ}%,bio.ilike.%${safeQ}%,location.ilike.%${safeQ}%`);
    }

    const { data: members, count, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      members: members.map(m => ({
        id: m.id,
        name: m.name,
        avatarUrl: m.avatar_url,
        bio: m.bio,
        location: m.location,
        instagram: m.instagram,
        website: m.website,
      })),
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / perPage),
    });
  } catch (error) {
    console.error('Directory search error:', error);
    return res.status(500).json({ message: 'Failed to search directory' });
  }
};
