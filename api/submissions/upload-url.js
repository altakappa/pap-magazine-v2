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
const { sendTextToTelegramSafe } = require('../_lib/telegram');

const BUCKET = 'submissions';
// 2026-07-29 — 30 → 50 (도메니코 결정). 룩 8개짜리 화보는 룩당 3장만 잡아도
// 24장이고 여기에 커버·비하인드가 붙으면 30장을 쉽게 넘긴다. 실제로 7/21
// 다나에 알라르콘 건이 여기 걸려 400 × 8 회를 맞았고, 최근 30일 제출 중
// 30장 초과가 0건인데 30장이 최빈값이었다 — 상한에서 잘린 벽이 보였다.
// 클라이언트(frontend/submission.html)의 MAX_TOTAL_IMAGES 와 반드시 같은 값.
const MAX_FILES = 50;
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

  // 2026-07-29 — 아래 400 분기들은 원래 code 도 로그도 없었다. 그래서 로그에는
  // "upload-url 400" 만 남고 장수·형식·용량 중 무엇에 걸렸는지 알 수 없었으며,
  // 프론트도 매핑할 키가 없어 회원에게는 "제출 실패" 일반 문구만 떴다.
  // 이제 (1) code 를 붙여 프론트가 9개 언어 문구로 매핑하고
  //     (2) console.error 로 어느 규칙에 걸렸는지 서버 로그에 남긴다.
  // 이 값들은 회원이 스스로 고칠 수 있는 제약이므로 상세를 알려주는 것이 맞다
  // (숨겨야 할 내부 구조가 아니다 — A-3 규칙의 대상은 DB/스토리지 원문 에러).
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) {
    console.error('[upload-url] rejected: no files, user=', user.id);
    return res.status(400).json({ message: 'No files specified', code: 'no_files' });
  }
  if (files.length > MAX_FILES) {
    console.error('[upload-url] rejected: too many files', files.length, '> ', MAX_FILES, 'user=', user.id);
    return res.status(400).json({
      message: `Too many files: ${files.length}. Maximum is ${MAX_FILES} images in total (looks + additional).`,
      code: 'too_many_files',
      count: files.length,
      max: MAX_FILES,
    });
  }

  // Validate each entry
  for (let i = 0; i < files.length; i++) {
    const f = files[i] || {};
    const type = String(f.type || '').toLowerCase();
    const size = Number(f.size) || 0;
    const category = String(f.category || '').toLowerCase();

    if (!ALLOWED_MIME.has(type)) {
      console.error('[upload-url] rejected: unsupported type', JSON.stringify(type), 'idx=', i, 'user=', user.id);
      return res.status(400).json({
        message: `File ${i + 1}: unsupported type "${type}"`,
        code: 'unsupported_type',
        index: i + 1,
      });
    }
    if (size <= 0 || size > MAX_FILE_SIZE) {
      console.error('[upload-url] rejected: bad size', size, 'idx=', i, 'user=', user.id);
      return res.status(400).json({
        message: `File ${i + 1}: size ${size} exceeds max ${MAX_FILE_SIZE}`,
        code: 'file_too_large',
        index: i + 1,
        maxBytes: MAX_FILE_SIZE,
      });
    }
    if (category !== 'look' && category !== 'additional') {
      console.error('[upload-url] rejected: invalid category', JSON.stringify(category), 'idx=', i, 'user=', user.id);
      return res.status(400).json({
        message: `File ${i + 1}: invalid category`,
        code: 'invalid_category',
        index: i + 1,
      });
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
    // 2026-07-28 — 업로드 URL 발급 실패도 즉시 텔레그램 알림(운영자 대면이라
    // 상세 OK). 실패해도 응답을 막지 않도록 try/catch 로 감싼다.
    try {
      await sendTextToTelegramSafe(
        '🚨 업로드URL 발급 실패\nuser=' + (user && user.id || '') +
        '\nmsg=' + String((err && err.message) || '').slice(0, 300)
      );
    } catch (_) { /* 알림 실패는 무시 */ }
    return res.status(500).json({
      message: 'Failed to create upload URLs. If this keeps happening, contact contact@pap-magazine.com',
      code: 'upload_url_failed',
    });
  }
};
