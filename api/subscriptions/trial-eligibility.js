/**
 * GET /api/subscriptions/trial-eligibility — 무료체험 자격 조회 (로그인 필수)
 *
 * 2026-08-03 시윤 3단계 — 재체험 차단.
 *
 * 왜 필요한가:
 *   해외 결제는 Paddle 이 merchant of record 라, 체험 기간은 Paddle price 에
 *   붙어 있다. 즉 같은 사람이 해지 후 다시 결제하면 또 7일 체험을 받는다.
 *   (국내 PortOne 경로에는 checkout.js:115 에 이미 가드가 있지만 그 경로는 죽었다.)
 *   그래서 "과거 구독 이력이 있으면 체험 없는 price 로 결제시킨다"는 판정을
 *   서버가 내려주고, 프론트가 그 답에 따라 price id 를 바꿔 끼운다.
 *
 * 응답: { eligible: boolean, reason: 'first_time' | 'prior_subscription' }
 *
 * 실패 정책(fail-open): 조회 자체가 실패하면 eligible:true 를 준다.
 *   - 진짜 신규 구독자에게 체험을 잘못 막으면 = 매출·신뢰 손실(즉시 청구 불만).
 *   - 드물게 재체험 1건이 새는 것 = 손실 소액.
 *   전자가 더 비싸므로 열어두는 쪽을 택한다. 대신 서버 로그에 남긴다.
 *
 * 캐시 금지: 회원별 응답이라 edge/브라우저 캐시에 담기면 안 된다.
 */

const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { supabaseAdmin } = require('../_lib/supabase');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { hasPriorSubscription } = require('../_lib/trialWindow');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  let prior = false;
  try {
    prior = await hasPriorSubscription(supabaseAdmin, user.id);
  } catch (e) {
    console.error('[trial-eligibility] lookup failed - failing open:', e && e.message);
    prior = false;
  }

  return res.status(200).json({
    eligible: !prior,
    reason: prior ? 'prior_subscription' : 'first_time',
  });
};
