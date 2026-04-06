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

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    for (const file of fileList) {
      const ext = file.originalFilename ? file.originalFilename.split('.').pop() : 'jpg';
      const storagePath = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const fileBuffer = fs.readFileSync(file.filepath);

      const { error: uploadError } = await supabaseAdmin.storage
        .from('media')
        .upload(storagePath, fileBuffer, {
          contentType: file.mimetype || 'image/jpeg',
          upsert: false
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        continue;
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
    console.error('Media upload error:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
