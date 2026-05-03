/**
 * POST /api/community/scrap-upload
 *
 * Member-accessible image upload for the scrapbook. Multipart form-data with
 * field name `file`. Returns { url } that the client uses to populate the
 * imageUrl field of a community_scraps row (or directly creates the scrap
 * row in a follow-up POST to /api/community/scraps).
 *
 * Distinct from /api/media/upload (which is admin-only). Uses the same
 * `media` Storage bucket but stores under `scraps/<userId>/...` so admin
 * uploads and member scraps stay logically separated.
 */

const fs = require('fs');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAuth } = require('../_lib/auth');
const { parseForm } = require('../_lib/upload');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif'];
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per scrap

module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.upload)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { files } = await parseForm(req, { maxFileSize: MAX_FILE_SIZE, maxFiles: 1 });
    const raw = files && (files.file || files.image || Object.values(files)[0]);
    const file = Array.isArray(raw) ? raw[0] : raw;
    if (!file) return res.status(400).json({ message: 'No file uploaded (field "file")' });

    // Validate
    const ext = (file.originalFilename ? file.originalFilename.split('.').pop() : '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext) && !ALLOWED_MIME.includes(mime)) {
      return res.status(415).json({ message: `Unsupported file type (${mime || ext || 'unknown'})` });
    }
    if (file.size > MAX_FILE_SIZE) {
      return res.status(413).json({ message: `File too large: ${(file.size/1024/1024).toFixed(1)}MB (max 10MB)` });
    }

    // Storage path: scraps/<userId>/<timestamp>_<rand>.<ext>
    const safeUserId = String(user.id || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon';
    const safeExt = ext && /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'jpg';
    const storagePath = `scraps/${safeUserId}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${safeExt}`;

    const buffer = fs.readFileSync(file.filepath);
    const { error: upErr } = await supabaseAdmin.storage
      .from('media')
      .upload(storagePath, buffer, {
        contentType: mime || 'image/jpeg',
        upsert: false,
      });
    if (upErr) {
      console.error('Scrap upload error:', upErr);
      return res.status(500).json({ message: 'Storage upload failed: ' + upErr.message });
    }

    const { data: urlData } = supabaseAdmin.storage.from('media').getPublicUrl(storagePath);
    return res.status(200).json({ url: urlData.publicUrl, path: storagePath });
  } catch (error) {
    console.error('Scrap upload handler error:', error);
    return res.status(500).json({ message: 'Upload failed: ' + (error.message || String(error)) });
  }
};
