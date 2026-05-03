/**
 * GET /api/pullletters/mine — Caller's own pull-letter requests.
 *
 * Returns the moodboard title (joined) for community-flow requests, plus a
 * fresh signed URL for any issued PDF (the 'pull-letters' bucket is private
 * — members can only access via these short-lived URLs).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const PDF_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { data: pullLetters, error } = await supabaseAdmin
      .from('pullletters')
      .select('*, mood_board:community_mood_boards!mood_board_id(id, title)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Mint short-lived signed URLs for both PDFs in the private bucket:
    //   - pull_letter_url: admin-issued letter (only present once status='issued')
    //   - proposal_pdf_url: member-uploaded 촬영시안
    async function sign(path) {
      if (!path) return null;
      try {
        const { data } = await supabaseAdmin.storage
          .from('pull-letters')
          .createSignedUrl(path, PDF_SIGNED_URL_TTL_SECONDS);
        return (data && data.signedUrl) || null;
      } catch (e) { return null; }
    }
    const enriched = await Promise.all((pullLetters || []).map(async pl => {
      const [pullLetterSignedUrl, proposalPdfSignedUrl] = await Promise.all([
        sign(pl.pull_letter_url),
        sign(pl.proposal_pdf_url),
      ]);
      return {
        ...pl,
        moodBoardTitle: pl.mood_board ? pl.mood_board.title : null,
        moodBoardId: pl.mood_board ? pl.mood_board.id : null,
        pullLetterSignedUrl,
        proposalPdfSignedUrl,
      };
    }));

    return res.status(200).json({ pullLetters: enriched });
  } catch (error) {
    console.error('Get my pull-letters error:', error);
    return res.status(500).json({ message: 'Failed to fetch pull-letters' });
  }
};
