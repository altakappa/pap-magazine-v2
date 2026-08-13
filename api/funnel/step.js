/**
 * POST /api/funnel/step — 전환 깔때기 한 걸음 기록 (2026-08-13 신설)
 *
 * 왜 ────────────────────────────────────────────────────────────────
 * 2026-08-12 기사 조회 계측으로 하루 661명이 사이트 안에서 기사를 연다는 게
 * 드러났다. 그런데 그 다음이 깜깜하다 — 구독 페이지에 몇 명이 닿는지 아무도
 * 모른다. Vercel Web Analytics 는 꺼져 있고(404 확인), 페이지에 붙은 분석
 * 스크립트도 없다. 웹의 존재 이유가 유료 구독자 증식(성장 헌법 1항)인데
 * 그 깔때기가 통째로 계측되지 않고 있었다.
 *
 * 설계는 api/articles/[id]/view.js 를 그대로 미러링한다 — 익명 친화, 봇 제외,
 * 실패는 조용히, 마이그레이션 미실행이면 204. 규칙을 새로 만들지 않는다.
 *
 * ⚠️ 결제 경로는 건드리지 않는다. 'checkout_start' 같은 단계는 STEPS 에
 *    넣어두지 않았다 — PayPal 전환(2026-08-10~12) 중에 결제 코드를 계측
 *    때문에 수정하는 건 순서가 틀렸다. 전환이 안정된 뒤 별건으로 한다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { isBot } = require('../_lib/botDetect');
const { verifyToken } = require('../_lib/auth');

/* 화이트리스트 — 아무 문자열이나 받으면 표가 쓰레기통이 된다.
   결제 단계는 의도적으로 없다(위 주석 참조). */
const STEPS = new Set(['subscribe_view']);

/* 성장 헌법 3항의 utm_source 목록 + 내부 유입. 그 외는 'other' 로 접는다 —
   자유 문자열을 그대로 저장하면 집계가 안 된다. */
const SOURCES = new Set([
  'x', 'ig', 'naver', 'kakao', 'newsletter', 'threads', 'tiktok', 'youtube',
  'internal', 'direct', 'other',
]);

const clip = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // 봇은 세지 않는다 (article_views·editorial_views 와 같은 방침).
  if (isBot(req.headers['user-agent'])) return res.status(204).end();

  const body = req.body || {};
  const step = String(body.step || '');
  if (!STEPS.has(step)) return res.status(400).json({ message: 'Unknown step' });

  const rawSource = String(body.source || '').toLowerCase();
  const source = SOURCES.has(rawSource) ? rawSource : 'other';

  let viewerId = null;
  try {
    const claims = verifyToken(req);
    if (claims && claims.userId) viewerId = claims.userId;
    else if (claims && claims.id) viewerId = claims.id;
    else if (claims && claims.sub) viewerId = claims.sub;
  } catch (_e) { /* 토큰 문제로 기록을 잃지 않는다 */ }

  try {
    let { error } = await supabaseAdmin
      .from('funnel_events')
      .insert({ step, source, path: clip(body.path, 200), user_id: viewerId });

    /* 탈퇴 계정의 유효 토큰(7일) → FK 위반. 익명으로 강등해 다시 기록한다.
       (article_views·editorial_views 와 같은 경계) */
    if (error && error.code === '23503' && viewerId) {
      viewerId = null;
      ({ error } = await supabaseAdmin
        .from('funnel_events')
        .insert({ step, source, path: clip(body.path, 200), user_id: null }));
    }

    if (error) {
      // 마이그레이션 124 미실행 — 표가 없다. 조용히 넘어간다.
      if (error.code === '42P01') {
        console.warn('[funnel] funnel_events 표가 없다 — 마이그레이션 124 미실행');
        return res.status(204).end();
      }
      console.error('[funnel] insert failed', error);
      return res.status(500).json({ message: 'Funnel record failed' });
    }

    return res.status(204).end();
  } catch (err) {
    console.error('[funnel] uncaught', err);
    return res.status(500).json({ message: 'Funnel record failed' });
  }
};
