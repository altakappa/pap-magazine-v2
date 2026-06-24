/**
 * GET /api/downloads/check — 현재 사용자의 콘텐츠 다운로드 권한 조회.
 *
 * QA #284 Phase 2. 정책:
 *   • admin (Main Admin)        → 모든 콘텐츠 다운로드 가능
 *   • staff (Sub Admin)         → 모든 콘텐츠 다운로드 가능
 *   • user (일반 회원/Contributor)
 *     - 본인이 참여한 에디토리얼만 (source_submission_id → submission.user_id 매칭)
 *     - 그 외 콘텐츠는 다운로드 불가
 *   • 비로그인                  → 401 (회원가입 CTA로 유도)
 *
 * 입력 (query):
 *   • type : 'editorial' | 'film' | 'article'  (필수)
 *   • id   : 콘텐츠 id (UUID 또는 숫자)         (필수)
 *
 * 출력:
 *   { allowed: boolean,
 *     role:    'admin' | 'staff' | 'user',
 *     reason:  'admin' | 'staff' | 'owner' | 'not-owner' | 'not-supported' }
 *
 * 다운로드 정책 변경 시 이 한 곳만 수정하면 됨 — UI와 로그 엔드포인트 모두 동일
 * 규칙을 공유.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const ALLOWED_TYPES = ['editorial', 'film', 'article'];

/**
 * 단일 권한 판정 함수. log 엔드포인트에서도 import해서 동일 정책 적용.
 *
 * @param {{id:string, role:string}} user — 인증된 사용자
 * @param {string} contentType
 * @param {string|number} contentId
 * @returns {Promise<{allowed:boolean, role:string, reason:string}>}
 */
async function checkDownloadPermission(user, contentType, contentId) {
  const role = (user.role || 'user').toLowerCase();

  // 1) 관리자는 항상 통과.
  if (role === 'admin') return { allowed: true, role: 'admin', reason: 'admin' };
  if (role === 'staff') return { allowed: true, role: 'staff', reason: 'staff' };

  // 2) 일반 회원 — editorial인 경우에만 본인 참여 여부 확인.
  //    film/article은 admin/staff만 다운로드 가능 (Contributor 매칭 대상 아님).
  if (contentType !== 'editorial') {
    return { allowed: false, role, reason: 'not-supported' };
  }
  if (!contentId) {
    return { allowed: false, role, reason: 'not-owner' };
  }

  try {
    // editorial → source_submission_id 조회.
    const { data: ed, error: e1 } = await supabaseAdmin
      .from('editorials')
      .select('source_submission_id')
      .eq('id', contentId)
      .single();
    if (e1 || !ed || !ed.source_submission_id) {
      return { allowed: false, role, reason: 'not-owner' };
    }
    // submission.user_id 조회 후 본인과 비교.
    const { data: sub, error: e2 } = await supabaseAdmin
      .from('submissions')
      .select('user_id')
      .eq('id', ed.source_submission_id)
      .single();
    if (e2 || !sub) {
      return { allowed: false, role, reason: 'not-owner' };
    }
    if (String(sub.user_id) === String(user.id)){
      return { allowed: true, role, reason: 'owner' };
    }
    return { allowed: false, role, reason: 'not-owner' };
  } catch (err) {
    console.error('[downloads/check] error:', err && err.message || err);
    return { allowed: false, role, reason: 'not-owner' };
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  const type = String(req.query.type || '').trim().toLowerCase();
  const id = String(req.query.id || '').trim();
  if (!ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({ message: 'Invalid type' });
  }
  if (!id) {
    return res.status(400).json({ message: 'Missing id' });
  }

  const result = await checkDownloadPermission(user, type, id);
  return res.status(200).json(result);
};

// CommonJS 양방향 export: default handler + named helper.
module.exports.checkDownloadPermission = checkDownloadPermission;
