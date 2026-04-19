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
 * Upload multiple files to a bucket
 * @param {string} bucket - Storage bucket name
 * @param {Array} files - Array of formidable file objects
 * @param {string} userId - User ID for folder organization
 * @returns {Array<string>} Array of URLs
 */
async function uploadFiles(bucket, files, userId) {
  if (!files || !Array.isArray(files)) return [];

  const urls = [];
  for (const file of files) {
    const ext = path.extname(file.originalFilename || file.newFilename);
    const timestamp = Date.now();
    const storagePath = `${userId}/${timestamp}_${Math.random().toString(36).slice(2)}${ext}`;

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
