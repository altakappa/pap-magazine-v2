/**
 * GET /api/casting-calls/current?lang=xx — 지금 보여줄 캐스팅 콜 (2026-10-02)
 * 로그인 토큰이 있고 연간 프리미엄이면 early_at 기준(7일 먼저), 아니면 public_at 기준.
 * 아직 공개 전인 콜이 있으면 {teaser:true, public_at} 로 "연간은 먼저 본다"를 알린다.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { verifyToken } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { findYearlyPremiumSubscription } = require('../_lib/premiumFeeWaiver');
const { hasActivePlan } = require('../_lib/subscriptionAccess');
const translate = require('../_lib/translate');
const { currentCastingCall } = require('../_lib/castingCall');
const LANGS = new Set(['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de']);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const lang = LANGS.has(String(req.query.lang || '')) ? String(req.query.lang) : 'en';
  let viewerYearly = false, viewerPaid = false;
  try {
    const user = verifyToken(req);
    if (user && user.id) {
      viewerYearly = !!(await findYearlyPremiumSubscription(supabaseAdmin, user.id));
      if (!viewerYearly) {   // 2026-10-03 월간 유료(스탠다드·프리미엄)는 3일 먼저
        const { data: prof } = await supabaseAdmin.from('profiles').select('subscription_plan, subscription_status').eq('id', user.id).maybeSingle();
        viewerPaid = hasActivePlan(prof || {}, 'standard');
      }
    }
  } catch (_) { viewerYearly = false; viewerPaid = false; }
  try {
    const cc = await currentCastingCall(supabaseAdmin, { lang, viewerYearly, viewerPaid, translate });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ call: cc, viewerYearly, viewerPaid, earlyDays: 7, paidEarlyDays: 3 });
  } catch (e) {
    console.error('[casting-calls/current]', e && e.message);
    return res.status(200).json({ call: null, viewerYearly, viewerPaid, earlyDays: 7, paidEarlyDays: 3 });
  }
};
