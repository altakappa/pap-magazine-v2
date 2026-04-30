/**
 * PAP Magazine - File Upload Helper
 * Handles multipart form parsing and Supabase Storage uploads
 */

// formidable v3 ships a function as the default export, but the CJS/ESM
// interop in Vercel's bundler sometimes hands back the namespace object
// instead — `formidable({...})` then throws "formidable is not a function"
// (the bug surfaced in production as the mysterious "Upload failed").
// Resolve to a callable in any of the three shapes the package can ship.
const formidableLib = require('formidable');
const formidable =
  typeof formidableLib === 'function' ? formidableLib :
  (formidableLib && (formidableLib.default || formidableLib.formidable)) ||
  null;
const IncomingFormCtor =
  (formidableLib && (formidableLib.IncomingForm || (formidableLib.default && formidableLib.default.IncomingForm))) ||
  null;
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('./supabase');

/**
 * Parse multipart form data
 * Returns { fields, files }
 */
function parseForm(req, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const config = {
      maxFileSize: opts.maxFileSize || 20 * 1024 * 1024, // 20MB default
      maxTotalFileSize: opts.maxTotalFileSize || (opts.maxFileSize ? opts.maxFileSize * 2 : 200 * 1024 * 1024),
      maxFiles: opts.maxFiles || 20,
      keepExtensions: true,
    };
    // Try the function-style factory first; fall back to the IncomingForm
    // constructor, which is exposed in every formidable version we've
    // shipped against. Throw a descriptive error when neither shape is
    // available so the catch block upstream can surface it.
    let form;
    try {
      if (typeof formidable === 'function') form = formidable(config);
      else if (typeof IncomingFormCtor === 'function') form = new IncomingFormCtor(config);
      else throw new Error('formidable export not callable; got ' + typeof formidableLib);
    } catch (initErr) {
      return reject(initErr);
    }

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

/**
 * Infer file extension from MIME for video files as fallback
 */
function extFromVideoMime(mimetype) {
  if (!mimetype) return '';
  const map = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-matroska': '.mkv',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/mpeg': '.mpeg',
    'video/3gpp': '.3gp',
  };
  return map[mimetype.toLowerCase()] || '';
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

  // Defensive: make sure userId is ASCII-safe for the storage path.
  // Supabase Storage allows only: alphanumerics, hyphen, underscore, dot, slash.
  // Strip to [A-Za-z0-9_-] for the userId segment; fall back to 'anon' if empty.
  let safeUserId = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeUserId) safeUserId = 'anon';

  const urls = [];
  for (const file of files) {
    let ext =
      sanitizeExt(file.originalFilename || file.newFilename) ||
      extFromMime(file.mimetype) ||
      extFromVideoMime(file.mimetype);
    // Final safety: ensure ext is `.` + [a-z0-9] or empty.
    if (ext && !/^\.[a-z0-9]{1,8}$/.test(ext)) ext = '';

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    // Path = userId/timestamp_rand.ext — all guaranteed ASCII-safe
    const storagePath = `${safeUserId}/${timestamp}_${rand}${ext}`;

    // Supabase path whitelist: alphanumerics, -, _, ., /. Validate before sending.
    if (!/^[A-Za-z0-9/_.-]+$/.test(storagePath)) {
      throw new Error(`Refusing unsafe storage path: ${storagePath}`);
    }

    try {
      const url = await uploadToStorage(
        bucket,
        file.filepath,
        storagePath,
        file.mimetype || 'application/octet-stream'
      );
      urls.push(url);
    } catch (e) {
      // Surface which file failed so client gets actionable feedback
      const name = file.originalFilename || file.newFilename || 'file';
      const msg = (e && e.message) ? e.message : String(e);
      throw new Error(`Upload of "${name}" failed: ${msg}`);
    }
  }
  return urls;
}

module.exports = { parseForm, uploadToStorage, uploadFiles, sanitizeExt, extFromMime, extFromVideoMime };
