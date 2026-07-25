/**
 * POST /api/submissions/upload-url
 *
 * Returns an array of signed upload URLs so the browser can PUT image files
 * directly to Supabase Storage, bypassing Vercel's 4.5 MB request-body limit.
 *
 * Request JSON body:
 *   {
 *     files: [
 *       { name: 'IMG_001.jpg', type: 'image/jpeg', size: 1234567, category: 'look' },
 *       ...
 *     ]
 *   }
 *
 * Response JSON body:
 *   {
 *     uploads: [
 *       {
 *         path:      'userid/1713456789000_abc12345.jpg',
 *         signedUrl: 'https://<project>.supabase.co/storage/v1/object/upload/sign/submissions/...',
 *         token:     '<short-lived token>',
 *         publicUrl: 'https://<project>.supabase.co/storage/v1/object/public/submissions/userid/...',
 *         category:  'look'
 *       },
 *       ...
 *     ]
 *   }
 *
 * The browser PUTs each file to `signedUrl` (Content-Type must match `type`).
 * When the submission metadata is finally posted to /api/submissions, the
 * server re-validates that every `publicUrl` lives under the caller's own
 * `{bucket}/{user.id}/…` prefix.
 */

const path = require('path');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const BUCKET = 'submissions';
const MAX_FILES = 30;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file (post-compression headroom)
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
]);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/tiff': '.tiff',
};

// A-6 정합 (2026-07-26) — 버킷 'submissions' 의 allowed_mime_types 는
// image/jpeg·png·webp·tiff 다. `image/jpg` 는 비표준이지만 일부 브라우저/OS 가
// 그대로 실어 보내고, 앱은 그걸 통과시킨다. 그 값으로 스토리지에 PUT 하면
// 버킷이 거부해 "앱은 통과시켰는데 업로드만 실패"하는 조용한 실패가 된다.
// 서명 URL 과 함께 '실제로 PUT 할 Content-Type' 을 정규화해 돌려주고,
// 클라이언트는 그 값을 그대로 쓴다.
const MIME_CANONICAL = {
  'image/jpg': 'image/jpeg',
};
function canonicalMime(type) {
  const t = String(type || '').toLowerCase();
  return MIME_CANONICAL[t] || t;
}

function sanitizeExt(filename) {
  if (!filename) return '';
  const raw = path.extname(String(filename)).toLowerCase();
  const m = raw.match(/^\.([a-z0-9]{1,8})$/);
  return m ? `.${m[1]}` : '';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.upload)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // Defensive: Vercel normally parses JSON bodies automatically, but req.body
  // can be missing / string depending on runtime — normalize here.
  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
  }

  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) {
    return res.status(400).json({ message: 'No files specified' });
  }
  if (files.length > MAX_FILES) {
    return res.status(400).json({ message: `Too many files (max ${MAX_FILES})` });
  }

  // Validate each entry
  for (let i = 0; i < files.length; i++) {
    const f = files[i] || {};
    const type = String(f.type || '').toLowerCase();
    const size = Number(f.size) || 0;
    const category = String(f.category || '').toLowerCase();

    if (!ALLOWED_MIME.has(type)) {
      return res.status(400).json({ message: `File ${i + 1}: unsupported type "${type}"` });
    }
    if (size <= 0 || size > MAX_FILE_SIZE) {
      return res.status(400).json({
        message: `File ${i + 1}: size ${size} exceeds max ${MAX_FILE_SIZE}`,
      });
    }
    if (category !== 'look' && category !== 'additional') {
      return res.status(400).json({ message: `File ${i + 1}: invalid category` });
    }
  }

  // Sanitize userId for storage path — same scheme as uploadFiles()
  let safeUserId = String(user.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeUserId) safeUserId = 'anon';

  const uploads = [];
  try {
    for (const f of files) {
      const type = String(f.type).toLowerCase();
      const ext =
        sanitizeExt(f.name) ||
        MIME_TO_EXT[type] ||
        '';

      const timestamp = Date.now();
      const rand = Math.random().toString(36).slice(2, 10);
      const storagePath = `${safeUserId}/${timestamp}_${rand}${ext}`;

      // Final whitelist check
      if (!/^[A-Za-z0-9/_.-]+$/.test(storagePath)) {
        return res.status(400).json({ message: 'Refusing unsafe storage path' });
      }

      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        // 보안: 내부 에러 상세는 서버 로그에만 — 클라이언트에는 일반 메시지
        // (스토리지 내부 구조/버전 정보 노출 방지)
        console.error('[upload-url] createSignedUploadUrl failed:', error);
        return res.status(500).json({ message: 'Failed to create signed upload URL' });
      }

      const { data: pubData } = supabaseAdmin.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

      uploads.push({
        path: storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
        publicUrl: pubData && pubData.publicUrl ? pubData.publicUrl : '',
        category: String(f.category).toLowerCase(),
        // A-6 — 클라이언트는 이 값으로 PUT 해야 버킷 MIME 검사를 통과한다.
        contentType: canonicalMime(type),
      });
    }

    return res.status(200).json({ uploads });
  } catch (err) {
    // 보안(2026-07-26 감사 A-3) — 원문 에러(err.message)를 클라이언트에 붙여
    // 내려보내지 않는다. 스토리지/DB 내부 구조가 노출된다. 상세는 서버 로그에만.
    console.error('[upload-url] error:', err);
    return res.status(500).json({
      message: 'Failed to create upload URLs. If this keeps happening, contact contact@pap-magazine.com',
      code: 'upload_url_failed',
    });
  }
};
