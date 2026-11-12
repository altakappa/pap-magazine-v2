/**
 * POST /api/news-tips/upload-url — 제보 미디어 업로드용 서명 URL
 *
 * body: { files: [{ name, type, size }] }
 * →     { uploads: [{ path, signedUrl, token, contentType }] }
 *
 * ■ 왜 2단계 직접 업로드인가
 * 도메니코 2026-11-11: "제보는 특별히 1기가 용량까지 허락해주자." 1GB 는
 * 서버 함수를 통과할 수 없는 크기다(Vercel 본문 상한 4.5MB). 그래서 브라우저가
 * 스토리지로 **직접** PUT 하고, 서버는 서명 URL 만 발급한다.
 *
 * ■ 공개 URL 을 돌려주지 않는다
 * 버킷 news-tips 는 **비공개**다. 제보 영상은 확인되기 전에 아무도 봐선 안 된다.
 * 그래서 publicUrl 이 아니라 **경로(path)** 만 돌려주고, 접수 때 그 경로를
 * 저장한다. 관리자 화면은 그때그때 서명 URL 을 만들어 본다.
 *
 * ■ 앱 화이트리스트 = 버킷 allowed_mime_types
 * 어긋나면 앱은 통과시켰는데 스토리지가 거부하는 '조용한 실패' 가 된다
 * (.claude/rules/api.md). 바이트가 서버를 거치지 않으므로 버킷 MIME 강제가
 * **유일한 관문**이고, 그래서 두 목록은 정확히 같아야 한다.
 *   버킷 설정: supabase_migrations/186_news_tips_bucket.sql
 */

'use strict';

const path = require('path');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const T = require('../_lib/newsTip');

const BUCKET = T.BUCKET;

function sanitizeExt(filename) {
  if (!filename) return '';
  const raw = path.extname(String(filename)).toLowerCase();
  const m = raw.match(/^\.([a-z0-9]{1,8})$/);
  return m ? `.${m[1]}` : '';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.upload)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
  }

  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) {
    console.error('[news-tips/upload-url] rejected: no files, user=', user.id);
    return res.status(400).json({ message: 'No files specified', code: 'no_files' });
  }
  if (files.length > T.MAX_FILES) {
    console.error('[news-tips/upload-url] rejected: too many files', files.length, 'user=', user.id);
    return res.status(400).json({
      message: 'Too many files: ' + files.length + '. Maximum is ' + T.MAX_FILES + '.',
      code: 'too_many_files', count: files.length, max: T.MAX_FILES,
    });
  }

  for (let i = 0; i < files.length; i++) {
    const f = files[i] || {};
    const type = T.canonicalMime(f.type);
    const size = Number(f.size) || 0;
    if (!T.ALLOWED_MIME.has(type)) {
      console.error('[news-tips/upload-url] rejected: unsupported type', JSON.stringify(type), 'idx=', i, 'user=', user.id);
      return res.status(400).json({
        message: 'File ' + (i + 1) + ': unsupported type "' + type + '"',
        code: 'unsupported_type', index: i + 1,
      });
    }
    const max = T.maxBytesFor(type);
    if (size <= 0 || size > max) {
      console.error('[news-tips/upload-url] rejected: bad size', size, 'max', max, 'idx=', i, 'user=', user.id);
      return res.status(400).json({
        message: 'File ' + (i + 1) + ': size ' + size + ' exceeds max ' + max,
        code: 'file_too_large', index: i + 1, maxBytes: max,
      });
    }
  }

  let safeUserId = String(user.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeUserId) safeUserId = 'anon';

  const uploads = [];
  try {
    for (const f of files) {
      const type = T.canonicalMime(f.type);
      const ext = sanitizeExt(f.name) || T.MIME_TO_EXT[type] || '';
      const storagePath = safeUserId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + ext;
      // 경로 화이트리스트 — 클라이언트가 보낸 이름이 경로를 벗어나지 못하게 한다.
      if (!/^[A-Za-z0-9/_.-]+$/.test(storagePath)) {
        return res.status(400).json({ message: 'Refusing unsafe storage path', code: 'unsafe_path' });
      }

      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);
      if (error || !data) {
        // 원문 에러는 서버 로그에만 (.claude/rules/api.md A-3)
        console.error('[news-tips/upload-url] createSignedUploadUrl failed:', error);
        return res.status(500).json({ message: 'Failed to create signed upload URL', code: 'upload_url_failed' });
      }

      uploads.push({
        path: storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
        // 클라이언트는 이 값으로 PUT 해야 버킷 MIME 검사를 통과한다.
        contentType: type,
      });
    }
    return res.status(200).json({ uploads });
  } catch (err) {
    console.error('[news-tips/upload-url] error:', err);
    try {
      await sendTextToTelegramSafe('🚨 제보 업로드URL 발급 실패\nuser=' + (user && user.id || '')
        + '\nmsg=' + String((err && err.message) || '').slice(0, 300));
    } catch (_) { /* 알림 실패는 무시 */ }
    return res.status(500).json({
      message: 'Failed to create upload URLs. If this keeps happening, contact contact@pap-magazine.com',
      code: 'upload_url_failed',
    });
  }
};
