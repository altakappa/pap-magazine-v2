/**
 * GET /api/cron/premium-review-sla
 *
 * 2026-09-13 도메니코 — 프리미엄 회원 서브미션은 "2영업일 이내 결과" 를 약속한다(우선 심사).
 * 약속은 사람이 지킨다. 이 크론은 매일 아침 한 번, 심사 대기(pending) 중인 프리미엄 회원 서브미션 가운데
 * 2영업일을 넘긴 건을 골라 운영자 텔레그램으로 올린다. 아무것도 자동으로 바꾸지 않는다(심사는 사람).
 *
 * 대상: status='pending' · 결제 승인 대기(awaiting_authorization)는 제외(크리에이터 몫이 남은 건) ·
 *       제출자가 지금 활성 프리미엄(profiles.subscription_plan=premium & status active/trialing).
 * 매일 같은 건이 다시 올라온다 — 의도다. 넘긴 채로 조용해지면 약속이 아니다.
 *
 * Security: Vercel cron 은 Bearer <CRON_SECRET>. 다른 크론과 같은 게이트.
 */
'use strict';
const { safeEqual } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard, reportProduction } = require('../_lib/cronGuard');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const { isPremiumProfile } = require('../_lib/collaborators');
const { isPremiumOverdue, overdueAlertText, PREMIUM_REVIEW_BUSINESS_DAYS } = require('../_lib/premiumReviewSla');

const CRON_NAME = 'premium-review-sla';
const MAX_PER_RUN = 200;

/** 크론이 고르는 규칙(순수 함수 — 테스트가 직접 돌린다). profileById: user_id → profiles 행 */
function pickOverdue(rows, profileById, now) {
  const out = [];
  for (const s of (rows || [])) {
    if (!s || String(s.status || '') !== 'pending') continue;
    if (String(s.payment_status || '') === 'awaiting_authorization') continue;
    const prof = profileById && profileById[s.user_id];
    if (!isPremiumProfile(prof)) continue;
    if (!isPremiumOverdue(s.created_at, now)) continue;
    out.push({ id: s.id, title: s.title, created_at: s.created_at, label: (prof && (prof.email || prof.display_name)) || '' });
  }
  return out;
}

module.exports = withCronGuard(CRON_NAME, async function handler(req, res) {
  if (handleCors(req, res)) return;
  res.locals = res.locals || {};

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) return res.status(500).json({ message: 'CRON_SECRET not configured' });
  if (!safeEqual(got, expected)) return res.status(401).json({ message: 'Unauthorized' });

  const stats = { scanned: 0, premium: 0, overdue: 0 };
  try {
    // 2영업일은 달력으로 최대 4일(금요일 제출 → 화요일). 그보다 오래된 pending 만 본다.
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from('submissions')
      .select('id, user_id, title, status, payment_status, created_at')
      .eq('status', 'pending')
      .lte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);
    if (error) throw error;
    stats.scanned = (rows || []).length;

    const ids = Array.from(new Set((rows || []).map((r) => r.user_id).filter(Boolean)));
    const profileById = {};
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from('profiles')
        .select('id, email, display_name, subscription_plan, subscription_status')
        .in('id', ids);
      for (const p of (profs || [])) profileById[p.id] = p;
    }
    stats.premium = (rows || []).filter((r) => isPremiumProfile(profileById[r.user_id])).length;

    const now = Date.now();
    const overdue = pickOverdue(rows, profileById, now);
    stats.overdue = overdue.length;
    if (overdue.length) {
      await sendTextToTelegramSafe(overdueAlertText(overdue, now));   // ★ await — 서버리스 동결
    }
    reportProduction(res, { produced: overdue.length, remaining: 0,
      note: 'scanned=' + stats.scanned + ' premiumPending=' + stats.premium + ' overdue=' + stats.overdue + ' sla=' + PREMIUM_REVIEW_BUSINESS_DAYS + 'bd' });
    return res.status(200).json({ ok: true, stats });
  } catch (err) {
    console.error('[cron/' + CRON_NAME + '] failed:', err && err.message);
    return res.status(500).json({ message: 'SLA sweep failed', error: err && err.message, stats });
  }
});
module.exports.pickOverdue = pickOverdue;
