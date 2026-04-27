/**
 * POST /api/admin/ads/upload-url — Signed upload URL for an ad creative.
 *
 * Mirrors /api/submissions/upload-url but writes to the `ads` bucket and
 * accepts video/* in addition to image/*.
 *
 * Body: { name, type, size }
 * Response: { signedUrl, publicUrl, path }
 */

const path = require('path');
const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

const BUCKET = 'ads';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — videos can be larger than image creatives
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
]);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg',
  'image/png':  '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4':  '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
};

function sanitizeExt(filename) {
  if (!filename) return '';
  const raw = path.extname(String(filename)).toLowerCase();
  const m = raw.match(/^\.([a-z0-9]{1,8})$/);
  return m ? `.${m[1]}` : '';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.upload)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
  }

  const type = String(body.type || '').toLowerCase();
  const size = Number(body.size) || 0;
  if (!ALLOWED_MIME.has(type)) {
    return res.status(400).json({ message: `Unsupported type "${type}"` });
  }
  if (size <= 0 || size > MAX_FILE_SIZE) {
    return res.status(400).json({ message: `File size ${size} exceeds max ${MAX_FILE_SIZE}` });
  }

  const ext = sanitizeExt(body.name) || MIME_TO_EXT[type] || '';
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const storagePath = `${timestamp}_${rand}${ext}`;
  if (!/^[A-Za-z0-9_.-]+$/.test(storagePath)) {
    return res.status(400).json({ message: 'Refusing unsafe storage path' });
  }

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      console.error('[admin/ads/upload-url] createSignedUploadUrl failed:', error);
      return res.status(500).json({
        message: 'Failed to create signed upload URL' + (error && error.message ? ` — ${error.message}` : ''),
      });
    }
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    return res.status(200).json({
      path: storagePath,
      signedUrl: data.signedUrl,
      token: data.token,
      publicUrl: pub && pub.publicUrl ? pub.publicUrl : '',
    });
  } catch (err) {
    console.error('[admin/ads/upload-url] error:', err);
    return res.status(500).json({ message: 'Upload URL error', detail: err.message });
  }
};
