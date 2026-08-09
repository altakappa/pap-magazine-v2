/**
 * POST   /api/social/ratings — 별점 등록/변경 (본인 upsert)
 * DELETE /api/social/ratings — 별점 취소 (본인 행만)
 *
 * 배경(2026-07 보안 감사 A-2): ratings 테이블의 "Anyone can update/delete"
 * RLS가 anon 키만으로 전체 별점 조작·삭제를 허용했다. 프론트는 Supabase
 * Auth 세션 없이 anon 키로 붙기 때문에 RLS로는 본인 검증이 불가능하다.
 * 쓰기 경로를 PAP JWT 검증 엔드포인트로 옮기고 anon의 UPDATE/DELETE
 * 정책은 회수했다. user_id는 항상 JWT에서 가져온다(클라이언트 값 무시).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, verifyToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // ── GET: 별점 통계 (2026-08-09) — 보는 건 로그인 불필요 ──
  // 별점이 참여 바(pap-engage)의 에디토리얼 평가 장치가 되면서(도메니코 결정:
  // 좋아요 대신 별점) SSR·SPA 모두 이 API 로 읽는다. myScore 는 JWT 가
  // 있을 때만 채운다 — verifyToken 은 실패해도 익명으로 계속 (react.js 패턴).
  if (req.method === 'GET') {
    try {
      const editorialTitle = String(req.query.editorial_title || '').slice(0, 300);
      if (!editorialTitle) return res.status(400).json({ message: 'Missing editorial_title' });
      const { data, error } = await supabaseAdmin
        .from('ratings').select('score, user_id')
        .eq('editorial_title', editorialTitle).limit(2000);
      if (error) throw error;
      const rows = data || [];
      const count = rows.length;
      const avg = count ? rows.reduce((a, r) => a + (Number(r.score) || 0), 0) / count : 0;
      const me = verifyToken(req);
      const mine = (me && me.id) ? rows.find((r) => String(r.user_id) === String(me.id)) : null;
      // user_id 목록은 응답에 싣지 않는다 — 내 점수 판별에만 서버 안에서 쓴다.
      return res.status(200).json({
        count: count,
        avg: Math.round(avg * 10) / 10,
        myScore: mine ? (Number(mine.score) || 0) : 0,
      });
    } catch (error) {
      console.error('[social/ratings] stats error:', error);
      return res.status(500).json({ message: 'Failed to load ratings' });
    }
  }

  const user = requireAuth(req, res);
  if (!user) return;

  // ── POST: 별점 등록/변경 (upsert) ──
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const editorialTitle = String(body.editorial_title || '').slice(0, 300);
      const score = parseInt(body.score, 10);

      if (!editorialTitle) return res.status(400).json({ message: 'Missing editorial_title' });
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        return res.status(400).json({ message: 'Score must be 1-5' });
      }

      const { error } = await supabaseAdmin.from('ratings').upsert(
        [{
          editorial_title: editorialTitle,
          user_id: String(user.id),
          score: score,
          updated_at: new Date().toISOString(),
        }],
        { onConflict: 'editorial_title,user_id' }
      );
      if (error) throw error;

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('[social/ratings] upsert error:', error);
      return res.status(500).json({ message: 'Failed to save rating' });
    }
  }

  // ── DELETE: 별점 취소 (본인 행만) ──
  if (req.method === 'DELETE') {
    try {
      const editorialTitle = String(
        (req.body && req.body.editorial_title) || req.query.editorial_title || ''
      ).slice(0, 300);
      if (!editorialTitle) return res.status(400).json({ message: 'Missing editorial_title' });

      const { error } = await supabaseAdmin
        .from('ratings')
        .delete()
        .eq('editorial_title', editorialTitle)
        .eq('user_id', String(user.id));
      if (error) throw error;

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('[social/ratings] delete error:', error);
      return res.status(500).json({ message: 'Failed to delete rating' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
