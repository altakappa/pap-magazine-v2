/**
 * PAP Magazine - File Upload Helper
 * Handles multipart form parsing and Supabase Storage uploads
 */

const formidable = require('formidable');
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('./supabase');

/**
 * Parse multipart form data
 * Returns { fields, files }
 */
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 20 * 1024 * 1024, // 20MB (reduced from 50MB)
      maxFiles: 20,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

/**
 * Upload a single file to Supabase Storage
 * @param {string} bucket - Storage bucket name
 * @param {string} filePath - Local file path from formidable
 * @param {string} storagePath - Destination path in bucket
 * @param {string} contentType - MIME type
 * @returns {string} Public URL or signed URL
 */
async function uploadToStorage(bucket, filePath, storagePath, contentType) {
  const fileBuffer = fs.readFileSync(filePath);

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  // Get public URL for public buckets, signed URL for private
  const { data: urlData } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

/**
 * Sanitize a file extension for Supabase Storage
 * Supabase Storage rejects paths with non-ASCII or special characters.
 * Returns a safe extension like ".jpg" (lowercase, ASCII only), or "" if none.
 */
function sanitizeExt(filename) {
  if (!filename) return '';
  const raw = path.extname(filename).toLowerCase();
  // Keep only ASCII letters/digits after the leading dot, up to 8 chars
  const m = raw.match(/^\.([a-z0-9]{1,8})$/);
  return m ? `.${m[1]}` : '';
}

/**
 * Infer an extension from MIME type as a fallback when the filename has none.
 */
function extFromMime(mimetype) {
  if (!mimetype) return '';
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
  };
  return map[mimetype.toLowerCase()] || '';
}

/**
 * Upload multiple files to a bucket
 * @param {string} bucket - Storage bucket name
 * @param {Array} files - Array of formidable file objects
 * @param {string} userId - User ID for folder organization
 * @returns {Array<string>} Array of URLs
 */
async function uploadFiles(bucket, files, userId) {
  if (!files || !Array.isArray(files)) return [];

  // Defensive: make sure userId is ASCII-safe for the storage path
  const safeUserId = String(userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '');

  const urls = [];
  for (const file of files) {
    const ext =
      sanitizeExt(file.originalFilename || file.newFilename) ||
      extFromMime(file.mimetype);
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    const storagePath = `${safeUserId}/${timestamp}_${rand}${ext}`;

    const url = await uploadToStorage(
      bucket,
      file.filepath,
      storagePath,
      file.mimetype || 'application/octet-stream'
    );
    urls.push(url);
  }
  return urls;
}

module.exports = { parseForm, uploadToStorage, uploadFiles };
