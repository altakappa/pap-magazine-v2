/**
 * GET  /api/auth/me  — Get current user profile
 * PUT  /api/auth/me  — Update current user profile
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (rateLimit(req, res, RATE_LIMITS.api)) return;

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
        },
      });
    }

    if (req.method === 'PUT') {
      const { name, bio, website, location, instagram } = req.body;

      // Only allow updating safe fields
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
        },
      });
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
