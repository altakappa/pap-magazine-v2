/**
 * POST /api/editorials/:id/view
 *
 * Records a single open of the editorial detail. Anonymous-friendly (no auth):
 * the table only stores editorial_id + timestamp, so there's nothing PII to
 * tie back to the visitor.
 *
 * Frontend calls this fire-and-forget when an editorial detail opens; the
 * 204 response means the caller can ignore the body entirely.
 *
 * Rate-limited per IP via the existing `api` preset (60/min). View inflation
 * by a single visitor is naturally capped — no honest user opens 60+ editorials
 * a minute, and abuse from one IP is blocked at that ceiling. Distributed
 * inflation (botnet) is out of scope for this iteration.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { isBot } = require('../../_lib/botDetect');
/* 2026-08-07 (도메니코 결정) — 로그인 회원의 조회만 누가 봤는지 남긴다.
   비회원은 지금까지처럼 익명 카운트(user_id = null).
   왜 필요한가 — 개인화('오늘의 PAP'·이어보기·안 읽은 표시)의 전제인데,
   이 표에는 사용자 컬럼 자체가 없었다. 회원 857명의 취향 데이터가
   하루도 안 쌓이고 있었다는 뜻이다.
   실패해도 조회 기록 자체를 막지 않는다 — 토큰이 없거나 깨져도 익명으로 남는다. */
const { verifyToken } = require('../../_lib/auth');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // 봇/크롤러 조회는 기록하지 않는다 (2026-07-22, 조회지표 봇 오염 방지).
  // Googlebot 등 JS 렌더 크롤러가 이 fire-and-forget 호출을 그대로 실행해
  // editorial_views 를 부풀리던 문제 차단. 봇에게도 204 로 응답해 정상 흐름 유지.
  if (isBot(req.headers['user-agent'])) {
    // 차단 건수만 하루 1행으로 집계(관측용). fire-and-forget — 실패해도
    // 봇 응답(204)에 영향 없음. 함수 미배포/에러 시 카운터만 안 쌓일 뿐.
    supabaseAdmin.rpc('bump_bot_view_block').then(() => {}, () => {});
    return res.status(204).end();
  }

  const id = req.query.id;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Missing editorial id' });
  }

  let viewerId = null;
  try {
    const claims = verifyToken(req);
    if (claims && claims.userId) viewerId = claims.userId;
    else if (claims && claims.id) viewerId = claims.id;
    else if (claims && claims.sub) viewerId = claims.sub;
  } catch (_e) { /* 토큰 문제로 조회 기록을 잃지 않는다 */ }

  try {
    const { error } = await supabaseAdmin
      .from('editorial_views')
      .insert({ editorial_id: id, user_id: viewerId });

    if (error) {
      // FK violation on a non-existent editorial id is the most common path
      // here (e.g. someone hitting the URL with a bogus id). Treat as 400 to
      // keep server-side logs clean.
      if (error.code === '23503') {
        return res.status(400).json({ message: 'Unknown editorial id' });
      }
      console.error('[editorial-view] insert failed', error);
      return res.status(500).json({ message: 'View record failed' });
    }

    // 204 — nothing for the fire-and-forget caller to process.
    res.status(204).end();
  } catch (err) {
    console.error('[editorial-view] uncaught', err);
    res.status(500).json({ message: 'View record failed' });
  }
};
