/**
 * GET /api/submissions/fee-waiver
 *
 * 서브미션 폼이 묻는다: "이 회원, 연간 프리미엄 €380 면제를 지금 쓸 수 있나?" (도메니코 2026-09-13)
 * 응답: { eligible, reason, periodEnd, usedAt }
 *   · eligible=true  → 소룩(€380) 유형으로 판정되면 결제 승인 없이 접수된다(서버가 POST 에서 다시 판정).
 *   · reason: not_yearly_premium | already_used | ok
 * 이 응답은 안내용이다 — 최종 판정은 POST /api/submissions 가 같은 lib(premiumFeeWaiver)로 한다.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAuth } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { checkFeeWaiver } = require('../_lib/premiumFeeWaiver');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const c = await checkFeeWaiver(supabaseAdmin, user.id);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      eligible: !!c.eligible,
      reason: c.reason,
      periodEnd: c.periodEnd || null,
      usedAt: c.usedAt || null,
      amountCents: 38000,
    });
  } catch (e) {
    console.error('[fee-waiver]', e && e.message);
    return res.status(200).json({ eligible: false, reason: 'error' });
  }
};
