/**
 * POST /api/articles/:id/view — 기사 상세 열람 1건 기록 (2026-08-12 신설)
 *
 * 왜 ────────────────────────────────────────────────────────────────
 * 실측(2026-08-12): 발행 기사 2,338편(30일 신규 1,891편)인데
 * `articles.view_count` 합계가 **0**이다. 컬럼은 있는데 올려주는 코드가 어디에도
 * 없었다 — admin 정렬·ops 대시보드·growthAudit 은 읽기만 한다.
 *
 * 그래서 기사 쪽은 **분모가 없다.** "기사 좋아요 30일 2건"이 나쁜 수치인지조차
 * 판정할 수 없다. 2,000명이 보고 2명이 눌렀으면 문제고, 20명이 보고 2명이
 * 눌렀으면 훌륭하다. 에디토리얼은 editorial_views 로 30일 11,003건이 잡히는데
 * 기사만 깜깜했다. 참여 개선을 하려면 분모부터 있어야 한다.
 *
 * 설계는 api/editorials/[id]/view.js 를 그대로 미러링한다 — 같은 모양이어야
 * 같은 쿼리로 비교된다. 규칙을 두 벌로 만들지 않는다.
 *
 * 익명 친화(로그인 불필요). 회원이면 user_id 를 남긴다(개인화 전제).
 * 봇은 세지 않는다. 실패는 조용히 — 계측이 화면을 막지 않는다.
 *
 * ⚠️ 마이그레이션 123 을 아직 실행하지 않았으면 표가 없다. 그때는 500 대신
 *    204 로 조용히 넘어간다 — 배포 순서 때문에 로그가 빨개지는 걸 막는다.
 */

'use strict';

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { isBot } = require('../../_lib/botDetect');
const { verifyToken } = require('../../_lib/auth');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 2026-08-22 — 화면(SSR/SPA) 구분. 웹→IG 전환율을 화면별로 재려면
   분자(아웃클릭)뿐 아니라 분모(조회)도 화면별로 있어야 한다.
   모르는 값은 넣지 않는다 — 틀린 라벨보다 빈 칸이 낫다. */
function readSurface(req) {
  var v = (req.body && req.body.surface) || (req.query && req.query.surface) || '';
  v = String(v).toLowerCase();
  return (v === 'ssr' || v === 'spa') ? v : null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // 봇/크롤러 조회는 기록하지 않는다 (editorial-view 와 동일 방침).
  // 봇에게도 204 를 준다 — 403 이면 재시도하고 로그만 지저분해진다.
  if (isBot(req.headers['user-agent'])) return res.status(204).end();

  const id = req.query.id;
  if (!id || typeof id !== 'string' || !UUID.test(id)) {
    return res.status(400).json({ message: 'Missing or invalid article id' });
  }

  let viewerId = null;
  try {
    const claims = verifyToken(req);
    if (claims && claims.userId) viewerId = claims.userId;
    else if (claims && claims.id) viewerId = claims.id;
    else if (claims && claims.sub) viewerId = claims.sub;
  } catch (_e) { /* 토큰 문제로 조회 기록을 잃지 않는다 */ }

  const surface = readSurface(req);

  try {
    let { error } = await supabaseAdmin
      .from('article_views')
      .insert({ article_id: id, user_id: viewerId, surface });

    /* 탈퇴 계정의 유효 토큰(7일) → profiles 에 행이 없어 FK 위반(23503).
       그 사람 조회를 잃을 이유는 없다 — 익명으로 강등해 다시 기록한다.
       (editorial-view 2026-08-08 와 같은 경계) */
    if (error && error.code === '23503' && viewerId) {
      viewerId = null;
      ({ error } = await supabaseAdmin
        .from('article_views')
        .insert({ article_id: id, user_id: null, surface }));
    }

    /* 마이그레이션 133 미실행 — surface 컬럼이 아직 없다.
       계측 하나 때문에 조회 기록 전체를 잃지 않는다. surface 를 빼고 한 번 더.
       ⚠ 2026-08-25 실측: PostgREST 는 없는 컬럼에 SQL 42703 이 아니라
       스키마 캐시 오류 PGRST204("Could not find the 'surface' column")를
       돌려준다. 42703 만 잡던 첫 구현이 이 코드를 놓쳐 8/23~24 하루 1,278건이
       500 으로 새고 조회 기록이 통째로 유실됐다(Vercel 런타임 로그 실측). */
    if (error && (error.code === '42703' || error.code === 'PGRST204') && surface) {
      ({ error } = await supabaseAdmin
        .from('article_views')
        .insert({ article_id: id, user_id: viewerId }));
    }

    if (error) {
      // 없는 기사 id (직접 URL 을 두드린 경우) — 로그를 더럽히지 않는다.
      if (error.code === '23503') return res.status(400).json({ message: 'Unknown article id' });
      // 마이그레이션 123 미실행 — 표가 없다. 조용히 넘어간다.
      if (error.code === '42P01') {
        console.warn('[article-view] article_views 표가 없다 — 마이그레이션 123 미실행');
        return res.status(204).end();
      }
      console.error('[article-view] insert failed', error);
      return res.status(500).json({ message: 'View record failed' });
    }

    return res.status(204).end();
  } catch (err) {
    console.error('[article-view] uncaught', err);
    return res.status(500).json({ message: 'View record failed' });
  }
};
