/**
 * POST /api/submissions       — Create new submission (user, multipart)
 * GET  /api/submissions        — List all submissions (admin, with ?status=&page=)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { parseForm, uploadFiles } = require('../_lib/upload');
const { sendEmail, templates } = require('../_lib/email');

// Disable Vercel body parsing for multipart
module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // ── POST: Create submission ──
  if (req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      const { fields, files } = await parseForm(req);

      // Parse the JSON data field
      const data = JSON.parse(
        Array.isArray(fields.data) ? fields.data[0] : fields.data
      );

      // Validate required fields
      if (!data.title || !data.title.trim()) {
        return res.status(400).json({ message: 'Title is required' });
      }
      if (!data.genre || !Array.isArray(data.genre) || data.genre.length === 0) {
        return res.status(400).json({ message: 'At least one genre is required' });
      }

      // Upload look images to Supabase Storage
      const lookImages = files.lookImages
        ? (Array.isArray(files.lookImages) ? files.lookImages : [files.lookImages])
        : [];
      const additionalImages = files.additionalImages
        ? (Array.isArray(files.additionalImages) ? files.additionalImages : [files.additionalImages])
        : [];

      const lookUrls = await uploadFiles('submissions', lookImages, user.id);
      const additionalUrls = await uploadFiles('submissions', additionalImages, user.id);

      // Insert submission
      const { data: submission, error } = await supabaseAdmin
        .from('submissions')
        .insert({
          user_id: user.id,
          title: data.title || 'Untitled',
          description: JSON.stringify({
            genre: data.genre || [],
            artistStatement: data.artistStatement || '',
            credits: data.credits || {},
            models: data.models || [],
            coverImageIndex: data.coverImageIndex || 0,
            contactEmail: data.contactEmail || '',
            contactName: data.contactName || '',
          }),
          file_urls: [...lookUrls, ...additionalUrls],
          credits: data.credits?.photographer || '',
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      // Send confirmation email (non-blocking)
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('email, name').eq('id', user.id).single();
      if (profile) {
        sendEmail(profile.email, templates.submissionReceived(
          { name: profile.name }, { title: data.title || 'Untitled' }
        )).catch(() => {});
      }

      return res.status(201).json({ submission });
    } catch (error) {
      console.error('Create submission error:', error);
      return res.status(500).json({ message: 'Failed to create submission' });
    }
  }

  // ── GET: List all submissions (admin) ──
  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    try {
      const { status, page = 1 } = req.query;
      const perPage = 20;
      const offset = (parseInt(page) - 1) * perPage;

      let query = supabaseAdmin
        .from('submissions')
        .select('*, profiles!inner(name, email, subscription_plan)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + perPage - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data: submissions, count, error } = await query;

      if (error) throw error;

      return res.status(200).json({
        submissions: submissions.map(s => ({
          ...s,
          submitterName: s.profiles?.name,
          submitterEmail: s.profiles?.email,
          submitterPlan: s.profiles?.subscription_plan,
        })),
        total: count,
        page: parseInt(page),
        totalPages: Math.ceil(count / perPage),
      });
    } catch (error) {
      console.error('List submissions error:', error);
      return res.status(500).json({ message: 'Failed to fetch submissions' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
