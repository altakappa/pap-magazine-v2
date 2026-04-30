/**
 * PAP Magazine - Media Upload API
 * POST /api/media/upload   → 이미지 업로드 (관리자)
 *
 * Returns public URL of uploaded file
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { parseForm } = require('../_lib/upload');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (rateLimit(req, res, RATE_LIMITS.upload)) return;

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const { files } = await parseForm(req);
    const uploaded = [];

    // Handle both single and multiple files
    const fileList = files.file ? (Array.isArray(files.file) ? files.file : [files.file]) : [];

    if (fileList.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const fs = require('fs');

    // Allowed MIME types and extensions for upload security
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm'];
    const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm'];
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB per file

    for (const file of fileList) {
      const ext = (file.originalFilename ? file.originalFilename.split('.').pop() : '').toLowerCase();
      const mime = (file.mimetype || '').toLowerCase();

      // Validate file extension
      if (!ALLOWED_EXT.includes(ext)) {
        return res.status(400).json({ error: `File type not allowed: .${ext}` });
      }

      // Validate MIME type
      if (!ALLOWED_MIME.includes(mime)) {
        return res.status(400).json({ error: `MIME type not allowed: ${mime}` });
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        return res.status(400).json({ error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 20MB)` });
      }

      const storagePath = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const fileBuffer = fs.readFileSync(file.filepath);

      const { error: uploadError } = await supabaseAdmin.storage
        .from('media')
        .upload(storagePath, fileBuffer, {
          contentType: file.mimetype || 'image/jpeg',
          upsert: false
        });

      if (uploadError) {
        // QA #100 follow-up — surface the actual Supabase error to the
        // admin instead of silently continuing. The previous behaviour
        // (continue → empty data array → client throws generic 'Upload
        // failed') hid every real cause: bucket misconfiguration, RLS
        // policy, name collision, etc. Now the admin sees the precise
        // reason and can act on it.
        console.error('Storage upload error:', uploadError);
        return res.status(500).json({
          error: 'Storage upload failed',
          detail: uploadError.message || String(uploadError),
          file: file.originalFilename || null
        });
      }

      const { data: urlData } = supabaseAdmin.storage
        .from('media')
        .getPublicUrl(storagePath);

      uploaded.push({
        url: urlData.publicUrl,
        name: file.originalFilename,
        size: file.size,
        type: file.mimetype
      });
    }

    return res.status(200).json({ data: uploaded });
  } catch (err) {
    // QA #100 follow-up — return the actual error detail (not just
    // "Upload failed") so the admin sees the real cause: formidable
    // size limit, malformed multipart, missing supabase credentials,
    // network blip, etc. Stack trace stays in the server log only.
    console.error('Media upload error:', err);
    return res.status(500).json({
      error: 'Upload failed',
      detail: (err && err.message) || String(err)
    });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
