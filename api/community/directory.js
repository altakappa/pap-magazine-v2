/**
 * GET /api/community/directory — Search creative directory (?role=&q=&page=)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

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
      .select('id, name, avatar_url, bio, location, instagram, website, subscription_plan', { count: 'exact' })
      .not('name', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    // Filter by role/profession if stored in bio
    if (role && role !== 'all') {
      query = query.ilike('bio', `%${role}%`);
    }

    // Text search
    if (q) {
      query = query.or(`name.ilike.%${q}%,bio.ilike.%${q}%,location.ilike.%${q}%`);
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
        plan: m.subscription_plan,
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
