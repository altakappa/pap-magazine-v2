/**
 * POST /api/pullletters/upload?id=<pullletter-uuid>
 *
 * Admin-only. Multipart upload of an issued pull-letter PDF to the private
 * 'pull-letters' Storage bucket. Returns the storage path. The admin UI then
 * calls PUT /api/pullletters/:id/review with { status:'issued', pullLetterPath }
 * to attach the path and stamp issued_at.
 *
 * Why split from /review: multipart parsing requires bodyParser:false, and
 * keeping the JSON-only review endpoint clean is easier than mixing both in
 * one handler.
 */

const fs = require('fs');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { parseForm } = require('../_lib/upload');

const BUCKET = 'pull-letters';
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB

module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ message: 'id required' });

  try {
    const { data: row, error: rowErr } = await supabaseAdmin
      .from('pullletters')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();
    if (rowErr || !row) return res.status(404).json({ message: 'Pull-letter request not found' });

    const { files } = await parseForm(req, { maxFileSize: MAX_PDF_BYTES, maxFiles: 1 });
    const raw = files && (files.pdf || files.file || Object.values(files)[0]);
    const file = Array.isArray(raw) ? raw[0] : raw;
    if (!file) return res.status(400).json({ message: 'No PDF uploaded (field "pdf")' });

    if (file.mimetype && file.mimetype !== 'application/pdf') {
      return res.status(415).json({ message: 'Only application/pdf accepted' });
    }

    const buffer = fs.readFileSync(file.filepath);
    const safeUserId = String(row.user_id || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon';
    const storagePath = `${safeUserId}/${id}-${Date.now()}.pdf`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (upErr) {
      // A-3 (2026-07-26 감사) — 스토리지 원문 메시지는 서버 로그에만.
      console.error('Pull-letter PDF upload error:', upErr);
      return res.status(500).json({ message: 'Storage upload failed', code: 'storage_upload_failed' });
    }

    return res.status(200).json({ pullLetterPath: storagePath });
  } catch (error) {
    console.error('Pull-letter upload handler error:', error);
    return res.status(500).json({ message: 'Upload failed' });
  }
};
