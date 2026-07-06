/**
 * GET  /api/auth/me  — Get current user profile
 * PUT  /api/auth/me  — Update current user profile
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAuthStrict } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { countryFromRequest } = require('../_lib/emailLocale');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // PUT (profile update) requires strict auth with DB token version check
  if (req.method === 'PUT') {
    const user = await requireAuthStrict(req, res);
    if (!user) return;

    try {
      const { name, bio, website, location, instagram } = req.body;

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (bio !== undefined) updates.bio = bio;
      if (website !== undefined) updates.website = website;
      if (location !== undefined) updates.location = location;
      if (instagram !== undefined) updates.instagram = instagram;

      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ message: 'Failed to update profile' });
      }

      return res.status(200).json({
        user: {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          role: profile.role,
          subscription: profile.subscription_plan,
          bio: profile.bio,
          website: profile.website,
          location: profile.location,
          instagram: profile.instagram,
          avatarUrl: profile.avatar_url,
          // QA #219 — creator recognition.
          isCreator: !!profile.is_creator,
          creatorSince: profile.creator_since || null,
        },
      });
    } catch (error) {
      console.error('Profile update error:', error);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  // GET and other methods use standard auth
  const user = requireAuth(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error || !profile) {
        return res.status(404).json({ message: 'Profile not found' });
      }

      // Opportunistic country capture (migration 038): /me runs on
      // every authenticated page load, so profiles.country self-heals
      // for legacy members. Fire-and-forget — never blocks the response.
      const cc = countryFromRequest(req);
      if (cc && profile.country !== cc) {
        supabaseAdmin.from('profiles').update({ country: cc }).eq('id', user.id)
          .then(({ error: e }) => { if (e) console.error('[auth/me] country update:', e.message); })
          .catch(err => console.error('[auth/me] country update threw:', err.message || err));
      }

      return res.status(200).json({
        user: {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          role: profile.role,
          subscription: profile.subscription_plan,
          subscriptionStatus: profile.subscription_status,
          bio: profile.bio,
          website: profile.website,
          location: profile.location,
          instagram: profile.instagram,
          avatarUrl: profile.avatar_url,
          createdAt: profile.created_at,
          // QA #219 — creator recognition.
          isCreator: !!profile.is_creator,
          creatorSince: profile.creator_since || null,
        },
      });
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
