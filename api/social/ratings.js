/**
 * GET    /api/social/ratings — 별점 통계 (로그인 불필요)
 * POST   /api/social/ratings — 별점 등록/변경 (upsert)
 * DELETE /api/social/ratings — 별점 취소 (본인 행만)
 *
 * 배경(2026-07 보안 감사 A-2): ratings 테이블의 "Anyone can update/delete"
 * RLS가 anon 키만으로 전체 별점 조작·삭제를 허용했다. 프론트는 Supabase
 * Auth 세션 없이 anon 키로 붙기 때문에 RLS로는 본인 검증이 불가능하다.
 * 쓰기 경로를 이 엔드포인트로 옮기고 anon의 UPDATE/DELETE 정책은 회수했다.
 *
 * 2026-08-12 — 쓰기에서 로그인 요구를 뺀다 (도메니코 결정) ──────────────
 * 실측(30일): 에디토리얼 조회 11,003건, 그중 **로그인 상태 조회 56건(0.5%)**,
 * 별점 9건(조회의 0.082%), 댓글 누적 0건.
 * 별점이 에디토리얼의 유일한 평가 장치인데 쓰기에 로그인을 요구했으니,
 * 보는 사람의 99.5%에게는 누를 수 있는 장치가 하나도 없었다. 성장 헌법 7항의
 * 사다리 1단(문턱 0)이 주력 콘텐츠에서 통째로 빠져 있던 셈이다.
 *
 * ⚠️ 보안 감사 A-2 는 그대로 지켜진다. 완화한 것은 "로그인해야 쓸 수 있다"
 *    뿐이고, **user_id 를 클라이언트에서 받지 않는다는 원칙은 유지**한다.
 *    키는 언제나 서버가 만든다:
 *        로그인   user_id = '<uuid>'        (기존 행과 그대로 호환)
 *        비로그인 user_id = 'ip:<ip_hash>'  (uuid 와 절대 충돌하지 않는 형식)
 *    따라서 비로그인 사용자가 남의 별점을 건드릴 방법은 없다. 자기 IP 해시
 *    키의 행 하나만 upsert/delete 할 수 있다. UNIQUE(editorial_title,user_id)
 *    가 1인 1표를 강제한다.
 *
 * ⚠️ 비로그인 집계는 완벽하지 않다. 같은 회선의 여러 사람은 한 명으로,
 *    모바일 IP 가 바뀌면 같은 사람이 여러 번으로 잡힌다. 그래도 '정확한 0'
 *    보다 '대략 맞는 숫자'가 낫다 — 이건 지표가 아니라 사회적 증거다.
 *    (content/react.js 와 같은 판단·같은 방식)
 *
 * 사다리는 없애지 않고 뒤로 미룬다: 별점을 남긴 **직후에** 로그인 유인을
 * 한 줄 보여준다(벽이 아니라 권유). 응답의 anon 플래그가 그 신호다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { verifyToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { extractClientIp, hashIp, isLikelyBot } = require('../_lib/clickGuard');

/**
 * 별점 1표의 주인을 서버에서 결정한다. 클라이언트 값은 절대 쓰지 않는다.
 * 로그인 사용자는 예전과 같은 uuid 그대로 — 기존 행이 계속 '내 별점'으로 잡힌다.
 */
function actorFor(req) {
  const user = verifyToken(req);
  if (user && user.id) return { key: String(user.id), anon: false };
  return { key: 'ip:' + hashIp(extractClientIp(req)), anon: true };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const actor = actorFor(req);

  // ── GET: 별점 통계 — 보는 건 언제나 로그인 불필요 ──
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
      // 비로그인도 '내 별점'을 본다 — 안 그러면 눌러도 반응이 없는 것처럼 보인다.
      const mine = rows.find((r) => String(r.user_id) === actor.key);
      // user_id 목록은 응답에 싣지 않는다 — 내 점수 판별에만 서버 안에서 쓴다.
      return res.status(200).json({
        count: count,
        avg: Math.round(avg * 10) / 10,
        myScore: mine ? (Number(mine.score) || 0) : 0,
        anon: actor.anon,
      });
    } catch (error) {
      console.error('[social/ratings] stats error:', error);
      return res.status(500).json({ message: 'Failed to load ratings' });
    }
  }

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

      /* 크롤러가 누른 것은 세지 않는다. 조용히 ok 를 돌려준다 —
         403 을 주면 봇이 재시도하고 로그만 지저분해진다 (react.js 와 동일). */
      if (isLikelyBot(req.headers['user-agent'])) {
        return res.status(200).json({ ok: true, anon: actor.anon });
      }

      const { error } = await supabaseAdmin.from('ratings').upsert(
        [{
          editorial_title: editorialTitle,
          user_id: actor.key,
          score: score,
          updated_at: new Date().toISOString(),
        }],
        { onConflict: 'editorial_title,user_id' }
      );
      if (error) throw error;

      return res.status(200).json({ ok: true, anon: actor.anon });
    } catch (error) {
      console.error('[social/ratings] upsert error:', error);
      return res.status(500).json({ message: 'Failed to save rating' });
    }
  }

  // ── DELETE: 별점 취소 (본인 행만 — 키를 서버가 만들므로 남의 행엔 못 닿는다) ──
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
        .eq('user_id', actor.key);
      if (error) throw error;

      return res.status(200).json({ ok: true, anon: actor.anon });
    } catch (error) {
      console.error('[social/ratings] delete error:', error);
      return res.status(500).json({ message: 'Failed to delete rating' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
