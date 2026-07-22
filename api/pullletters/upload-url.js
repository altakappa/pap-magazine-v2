/**
 * POST /api/pullletters/upload-url
 * ═══════════════════════════════════════════════════════════════════
 * 풀레터 첨부(무드보드 이미지 · 촬영시안 PDF)를 Supabase Storage 로
 * 직접 올리기 위한 서명 URL 발급. 2026-07-21 신설.
 *
 * ── 왜 만들었나 (QA: 신청 단계에서야 payload 초과 오류) ─────────────
 * 기존 POST /api/pullletters 는 무드보드와 PDF 를 multipart 로 요청에
 * 통째로 실어 보냈다. 그런데 Vercel 서버리스 함수의 요청 본문 한계는
 * 4.5MB 다. 안내는 "무드보드 25MB · 시안 20MB" 였으니 안내를 믿고 넣은
 * 사용자는 3MB PDF 하나로도 한계를 넘겨, 신청 버튼을 누른 뒤에야
 * "Request payload too large" 라는 영문 시스템 오류를 만났다.
 *
 * 파일 선택 시점엔 아무것도 전송되지 않고 신청 시 한꺼번에 올라가는
 * 구조라, 화면의 "3.0MB" 표시는 그저 로컬 파일 정보였다 — QA 가 짚은
 * "업로드 완료로 보이나 실제로는 실패"가 정확히 이것이다.
 *
 * 서브미션은 이미 같은 문제를 겪고 2단계 직접 업로드로 해결해 뒀다
 * (api/submissions/upload-url.js). 풀레터만 옛 방식에 남아 있었다.
 * 그 방식을 그대로 가져온다.
 *
 * ── 흐름 ────────────────────────────────────────────────────────────
 *   1. POST /pullletters/upload-url  → 파일별 서명 URL 발급
 *   2. 클라이언트가 각 파일을 스토리지로 직접 PUT (요청 본문 한계 무관)
 *   3. POST /pullletters 에 JSON 메타데이터 + 결과 경로만 전송
 *
 * Request:
 *   { files: [{ name, type, size, category }] }
 *     category: 'moodboard' | 'proposal'
 *
 * Response:
 *   { uploads: [{ path, signedUrl, token, publicUrl, category, bucket }] }
 *
 * ── 버킷이 둘인 이유 ────────────────────────────────────────────────
 *   · moodboard → 'pullletters' (공개). 관리자 화면에서 바로 보여준다.
 *   · proposal  → 'pull-letters' (비공개). 촬영시안은 팀의 기획서라
 *     공개 URL 로 노출되면 안 된다. 회원은 mine.js 가 발급하는 서명
 *     URL 로만 읽는다. 기존 서버 업로드 경로와 동일한 규칙을 지킨다.
 */

const path = require('path');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const MAX_FILES = 21;                               // 무드보드 20 + 시안 1
const MAX_MOODBOARD_SIZE = 25 * 1024 * 1024;        // 안내 문구와 동일
const MAX_PROPOSAL_SIZE = 25 * 1024 * 1024;         // 무드보드와 동일하게 통일 (도메니코 2026-07-22)

// 무드보드 허용 형식 — Supabase 버킷 'pullletters' 의 allowed_mime_types 와 정확히
// 일치시킨다. 버킷이 실제 최종 관문이므로(서명 업로드 PUT 이 버킷 MIME 을 검사),
// 앱이 통과시킨 형식이 스토리지에서 거부되면 안 된다.
// 2026-07-22 정합: 버킷이 허용하는 gif·heic·heif·avif 추가, 버킷이 거부하는 tiff 제거
// (예전엔 tiff 를 앱이 통과시켜 스토리지에서 조용히 실패할 수 있었다).
const MOODBOARD_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/avif',                                    // 아이폰/모던 이미지
  'application/pdf',
  'application/vnd.ms-powerpoint',                                              // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',  // .pptx
]);
// 확장자 폴백 — 일부 브라우저/OS 는 HEIC·PPT 등에 빈 MIME 를 실어 보낸다. 그때는
// 파일명 확장자로 판정해 '올렸는데 거부'를 막는다. (버킷 허용 세트와 동일 범위)
const MOODBOARD_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif', '.pdf', '.ppt', '.pptx',
]);
const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/heic': '.heic', 'image/heif': '.heif', 'image/avif': '.avif', 'application/pdf': '.pdf',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

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
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = await requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  const files = Array.isArray(body.files) ? body.files : null;
  if (!files || files.length === 0) {
    return res.status(400).json({ message: 'files array is required' });
  }
  if (files.length > MAX_FILES) {
    return res.status(400).json({ message: `Too many files (max ${MAX_FILES})` });
  }

  // ── 검증 ──
  // 여기서 거절하면 사용자는 "선택 즉시" 안내를 받는다. 신청 버튼까지
  // 갔다가 실패하는 일이 없도록 하는 것이 이 엔드포인트의 존재 이유다.
  let proposalCount = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i] || {};
    const type = String(f.type || '').toLowerCase();
    const size = Number(f.size) || 0;
    const category = String(f.category || '').toLowerCase();

    if (category !== 'moodboard' && category !== 'proposal') {
      return res.status(400).json({ message: `File ${i + 1}: invalid category` });
    }
    if (category === 'proposal') {
      proposalCount++;
      if (type !== 'application/pdf') {
        return res.status(415).json({ message: `File ${i + 1}: proposal must be application/pdf` });
      }
      if (size <= 0 || size > MAX_PROPOSAL_SIZE) {
        return res.status(400).json({
          message: `File ${i + 1}: proposal size ${size} exceeds max ${MAX_PROPOSAL_SIZE}`,
        });
      }
    } else {
      const ext = sanitizeExt(f.name);
      if (!MOODBOARD_MIME.has(type) && !MOODBOARD_EXT.has(ext)) {
        return res.status(415).json({ message: `File ${i + 1}: unsupported moodboard type` });
      }
      if (size <= 0 || size > MAX_MOODBOARD_SIZE) {
        return res.status(400).json({
          message: `File ${i + 1}: moodboard size ${size} exceeds max ${MAX_MOODBOARD_SIZE}`,
        });
      }
    }
  }
  if (proposalCount > 1) {
    return res.status(400).json({ message: 'Only one proposal PDF is allowed' });
  }

  // 스토리지 경로용 userId 정제 — 기존 uploadFiles()/index.js 와 같은 방식
  let safeUserId = String(user.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeUserId) safeUserId = 'anon';

  const uploads = [];
  try {
    for (const f of files) {
      const type = String(f.type).toLowerCase();
      const category = String(f.category).toLowerCase();
      const ext = sanitizeExt(f.name) || MIME_TO_EXT[type] || '';

      const timestamp = Date.now();
      const rand = Math.random().toString(36).slice(2, 10);

      // 촬영시안은 비공개 버킷의 proposals/ 아래 — 기존 서버 업로드 경로와 동일
      const isProposal = category === 'proposal';
      const bucket = isProposal ? 'pull-letters' : 'pullletters';
      const storagePath = isProposal
        ? `proposals/${safeUserId}/${timestamp}_${rand}.pdf`
        : `${safeUserId}/${timestamp}_${rand}${ext}`;

      if (!/^[A-Za-z0-9/_.-]+$/.test(storagePath)) {
        return res.status(400).json({ message: 'Refusing unsafe storage path' });
      }

      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        // 보안: 내부 에러 상세는 서버 로그에만 (스토리지 구조 노출 방지)
        console.error('[pullletters/upload-url] createSignedUploadUrl failed:', error);
        return res.status(500).json({ message: 'Failed to create signed upload URL' });
      }

      // 공개 버킷만 publicUrl 을 돌려준다. 비공개(pull-letters)는 경로만
      // 저장하고 열람 시 mine.js 가 서명 URL 을 새로 발급한다.
      let publicUrl = '';
      if (!isProposal) {
        const { data: pubData } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
        publicUrl = (pubData && pubData.publicUrl) || '';
      }

      uploads.push({
        path: storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
        publicUrl,
        category,
        bucket,
      });
    }

    return res.status(200).json({ uploads });
  } catch (err) {
    console.error('[pullletters/upload-url] error:', err);
    return res.status(500).json({ message: 'Failed to create upload URLs' });
  }
};
