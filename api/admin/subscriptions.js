/**
 * GET /api/admin/subscriptions — 관리자 '구독 현황' 표/요약 (Paddle 단독).
 *
 * subscriptions + profiles 조인. 각 구독을 유료/체험/연체/취소/일시정지로 분류.
 * 체험 판정: Paddle webhook 이 trialing→'active' 로 저장(열람권한용)하므로,
 * 현재 청구주기 길이로 구분한다 — PAP 유료 주기는 월(~30일)·연(~365일)뿐이라
 * 10일 미만이면 무료 체험(7일)으로 본다(첫 결제 전 → 매출 제외).
 * 정렬: 연체 > 체험(종료 임박순) > 유료 > 일시정지 > 취소.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

// ₩ 가격 — api/admin/stats.js · api/subscriptions/checkout.js 와 일치해야 함.
const PLAN_PRICE = { standard_monthly: 8500, standard_yearly: 85000, premium_monthly: 13500, premium_yearly: 135000 };
function planToMonthly(plan) {
  const p = PLAN_PRICE[plan] || 0;
  return (plan && plan.endsWith('_yearly')) ? Math.round(p / 12) : p;
}
function planLabel(plan) {
  const base = (plan && plan.indexOf('premium') > -1) ? 'Premium'
             : (plan && plan.indexOf('standard') > -1) ? 'Standard' : 'Free';
  const cyc = (plan && plan.endsWith('_yearly')) ? '연'
            : (plan && plan.endsWith('_monthly')) ? '월' : '';
  return cyc ? (base + ' · ' + cyc) : base;
}
function periodDays(a, b) {
  if (!a || !b) return null;
  const d = (new Date(b) - new Date(a)) / 86400000;
  return isFinite(d) ? d : null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const { data: subs, error } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, plan, status, billing_cycle, current_period_start, current_period_end, paddle_subscription_id, updated_at, created_at')
      .order('updated_at', { ascending: false })
      .limit(2000);
    if (error) throw error;

    const ids = Array.from(new Set((subs || []).map((s) => s.user_id).filter(Boolean)));
    const profById = {};
    if (ids.length) {
      const { data: profs } = await supabaseAdmin.from('profiles').select('id, display_name, email').in('id', ids);
      (profs || []).forEach((p) => { profById[p.id] = p; });
    }

    const now = Date.now();
    const rows = (subs || []).map((s) => {
      const p = profById[s.user_id] || {};
      const days = periodDays(s.current_period_start, s.current_period_end);
      let kind;
      if (s.status === 'canceled') kind = 'canceled';
      else if (s.status === 'past_due') kind = 'past_due';
      else if (s.status === 'paused') kind = 'paused';
      else if (s.status === 'active' && days != null && days > 0 && days < 10) kind = 'trialing';
      else if (s.status === 'active') kind = 'paying';
      else kind = s.status || 'unknown';
      let daysToEnd = null;
      if (s.current_period_end) daysToEnd = Math.ceil((new Date(s.current_period_end).getTime() - now) / 86400000);
      return {
        email: p.email || null,
        display_name: p.display_name || null,
        plan: s.plan || null,
        plan_label: planLabel(s.plan),
        status: s.status || null,
        kind,
        billing_cycle: s.billing_cycle || null,
        current_period_start: s.current_period_start || null,
        current_period_end: s.current_period_end || null,
        days_to_period_end: daysToEnd,
        paddle_sub_tail: s.paddle_subscription_id ? String(s.paddle_subscription_id).slice(-8) : null,
      };
    });

    const rank = { past_due: 0, trialing: 1, paying: 2, paused: 3, canceled: 4 };
    rows.sort((a, b) => {
      const ra = (rank[a.kind] != null ? rank[a.kind] : 9);
      const rb = (rank[b.kind] != null ? rank[b.kind] : 9);
      if (ra !== rb) return ra - rb;
      if (a.kind === 'trialing' && b.kind === 'trialing') {
        const da = (a.days_to_period_end == null ? 999 : a.days_to_period_end);
        const db = (b.days_to_period_end == null ? 999 : b.days_to_period_end);
        return da - db;
      }
      return 0;
    });

    const summary = {
      paying: 0, trialing: 0, past_due: 0, paused: 0, canceled: 0,
      mrr: 0, standard: 0, premium: 0, trialing_standard: 0, trialing_premium: 0,
    };
    for (const r of rows) {
      summary[r.kind] = (summary[r.kind] || 0) + 1;
      if (r.kind === 'paying') {
        summary.mrr += planToMonthly(r.plan);
        if ((r.plan || '').indexOf('standard') > -1) summary.standard += 1;
        else if ((r.plan || '').indexOf('premium') > -1) summary.premium += 1;
      } else if (r.kind === 'trialing') {
        if ((r.plan || '').indexOf('standard') > -1) summary.trialing_standard += 1;
        else if ((r.plan || '').indexOf('premium') > -1) summary.trialing_premium += 1;
      }
    }

    return res.status(200).json({ rows, summary });
  } catch (e) {
    console.error('[admin/subscriptions] error:', e);
    return res.status(500).json({ message: '구독 현황 조회 실패' });
  }
};
