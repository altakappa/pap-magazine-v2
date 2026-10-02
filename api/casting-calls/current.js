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
const translate = require('../_lib/translate');
const { currentCastingCall } = require('../_lib/castingCall');
const LANGS = new Set(['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de']);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const lang = LANGS.has(String(req.query.lang || '')) ? String(req.query.lang) : 'en';
  let viewerYearly = false;
  try {
    const user = verifyToken(req);
    if (user && user.id) viewerYearly = !!(await findYearlyPremiumSubscription(supabaseAdmin, user.id));
  } catch (_) { viewerYearly = false; }
  try {
    const cc = await currentCastingCall(supabaseAdmin, { lang, viewerYearly, translate });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ call: cc, viewerYearly, earlyDays: 7 });
  } catch (e) {
    console.error('[casting-calls/current]', e && e.message);
    return res.status(200).json({ call: null, viewerYearly, earlyDays: 7 });
  }
};
