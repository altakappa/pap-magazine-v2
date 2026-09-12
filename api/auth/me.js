/**
 * GET  /api/auth/me  — Get current user profile
 * PUT  /api/auth/me  — Update current user profile
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAuthStrict } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { countryFromRequest } = require('../_lib/emailLocale');
const { normalizeHandle } = require('../_lib/collaborators');

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
      // 2026-09-12 — 인스타그램 아이디는 공동작업자 지정의 열쇠다(도메니코: 프리미엄 회원만 지정 가능).
      // 정규화(소문자·@ 제거·URL 벗김)해서 저장하고, 다른 계정이 이미 쓰는 아이디는 거부한다 —
      // 한 아이디가 두 계정에 걸리면 누가 프리미엄인지 판정할 수 없다.
      if (instagram !== undefined) {
        const raw = String(instagram == null ? '' : instagram).trim();
        if (raw === '') {
          updates.instagram = null;
        } else {
          const h = normalizeHandle(raw);
          if (!h) return res.status(400).json({ code: 'INSTAGRAM_INVALID', message: 'Invalid Instagram handle' });
          const { data: taken } = await supabaseAdmin
            .from('profiles').select('id').eq('instagram', h).neq('id', user.id).limit(1);
          if (taken && taken.length) return res.status(409).json({ code: 'INSTAGRAM_TAKEN', message: 'This Instagram handle is already registered to another account' });
          updates.instagram = h;
        }
      }

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
