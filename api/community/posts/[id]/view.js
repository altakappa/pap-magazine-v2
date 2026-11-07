/**
 * POST /api/community/posts/:id/view — 커뮤니티 글 조회 1건 기록
 *
 * 왜 새로 만들었나 (2026-11-07 보안감사 M-6) — 종전에는 프런트가 **공개 anon 키로
 * `community_post_views` 에 직접 INSERT** 했다(`SB.recordView`). 그 표의 INSERT 정책이
 * `with_check: true` 였고 anon 에 INSERT 그랜트도 있어, 로그인도 필요 없이 누구나
 * 조회 행을 무한히 넣을 수 있었다 — 조회수 조작과 DB 용량 공격이 동시에 열린 상태다.
 *
 * 그래서 쓰기를 서버(service_role)로 끌어오고, anon 의 INSERT 그랜트와 그 정책은
 * 마이그레이션 181 에서 회수한다. 구조는 이미 있는 `api/editorials/[id]/view.js` 와
 * 똑같이 맞췄다 — 규칙이 두 벌이면 한쪽만 고쳐진다.
 *
 * 비회원도 기록한다(viewer_id = null). 표에는 글 id·시각·조회자 id 만 들어가므로
 * 비회원 경로에 남는 개인정보가 없다.
 *
 * 레이트리밋은 기존 `api` 프리셋(IP당 60/분). 한 사람이 1분에 글 60개를 열 일은
 * 없으니 단일 IP 부풀리기는 여기서 막힌다. 분산 봇넷은 이번 범위가 아니다.
 * 봇·크롤러 조회는 기록하지 않는다(조회지표 봇 오염 방지, editorials/view 와 동일).
 *
 * 응답은 204 — 프런트는 fire-and-forget 으로 호출하고 본문을 보지 않는다.
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');
const { isBot } = require('../../../_lib/botDetect');
const { verifyToken } = require('../../../_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ message: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const postId = req.query && req.query.id;
  if (!postId) return res.status(400).json({ message: 'post id is required', code: 'post_id_required' });

  // 봇은 조용히 204 — 기록은 안 하지만 프런트에 오류를 돌려줄 이유도 없다.
  if (isBot(req.headers['user-agent'])) return res.status(204).end();

  /* 로그인 회원이면 누가 봤는지 남긴다. 토큰이 없거나 깨져도 기록 자체를 막지
     않는다 — 익명(null)으로 남는다. (editorials/view 와 같은 규칙) */
  let viewerId = null;
  try {
    const u = verifyToken(req);
    if (u && u.id) viewerId = u.id;
  } catch (_) { /* 익명으로 계속 */ }

  try {
    const { error } = await supabaseAdmin
      .from('community_post_views')
      .insert({ post_id: postId, viewer_id: viewerId });
    if (error) throw error;
  } catch (err) {
    /* 조회 기록 실패가 글 열기를 막아선 안 된다. 상세는 로그로만
       (api 규칙: 원문 에러를 응답에 싣지 않는다). */
    console.error('[community-post-view] insert 실패:', err && err.message);
    return res.status(204).end();
  }

  return res.status(204).end();
};
