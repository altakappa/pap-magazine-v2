/**
 * GET /api/admin/subscriptions — 관리자 '구독 현황' 표/요약.
 *
 * 2026-08-12 — 결제사는 PayPal 이다(Paddle 은 8/14 폐쇄). 금액은 전부 EUR 센트.
 *
 * subscriptions + profiles 조인. 각 구독을 유료/체험/연체/취소/일시정지로 분류.
 * 체험 판정: Paddle webhook 이 trialing→'active' 로 저장(열람권한용)하므로,
 * 현재 청구주기 길이로 구분한다 — PAP 유료 주기는 월(~30일)·연(~365일)뿐이라
 * 10일 미만이면 무료 체험(7일)으로 본다(첫 결제 전 → 매출 제외).
 * 정렬: 연체 > 체험(종료 임박순) > 유료 > 일시정지 > 취소.
 *
 * 날짜는 전부 KST(한국시간) 달력일로 내려준다 — DB 는 UTC 라서 문자열을 그대로
 * 자르면 하루가 밀린다(UTC 08-07 16:44 = KST 08-08 01:44 → 실제 결제일은 8/8).
 * D-N 도 '시간 차 ÷ 24h' 가 아니라 KST 달력일 번호의 차이로 센다 — 그래야 같은
 * 날 결제되는 두 사람이 D-5 / D-6 처럼 서로 다르게 보이지 않는다.
 * ⚠ 여기 날짜는 '카드가 긁히는 날' 이다. 통장에 실제로 들어오는 날은 PayPal 잔액
 * 인출 주기에 따라 그보다 늦다 — 화면에도 그렇게 적는다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

// 🔴 2026-08-12 — EUR 센트. 여기만 원화 표(8500/85000/13500/135000)로 남아 있었다.
// PayPal 은 플랜당 통화가 하나뿐이라 구독가를 EUR 단일가로 합쳤는데, 어드민 매출
// 계산이 안 따라왔다. 환산 코드가 없어 화면의 ₩ 숫자는 어떤 환율로도 맞지 않았다.
// ⚠️ api/admin/stats.js · frontend/subscribe.html 의 EUR_PRICES 와 같은 값일 것.
const PLAN_PRICE = { standard_monthly: 549, standard_yearly: 4599, premium_monthly: 899, premium_yearly: 7499 };
const PLAN_PRICE_CURRENCY = 'EUR';
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

// ── KST(한국시간) 달력 계산 ─────────────────────────────────────────────
// 저장값은 UTC. 9시간을 더한 뒤 getUTC* 로 읽으면 그게 곧 한국 벽시계다.
const KST_MS = 9 * 60 * 60 * 1000;
const KST_DOW = ['일', '월', '화', '수', '목', '금', '토'];
function kstShift(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return new Date(t + KST_MS);
}
function kstDayNo(iso) { // KST 달력일 일련번호 — 같은 날이면 같은 값
  const d = kstShift(iso);
  return d ? Math.floor(d.getTime() / 86400000) : null;
}
function kstDateStr(iso) {
  const d = kstShift(iso);
  if (!d) return null;
  return d.getUTCFullYear()
    + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
    + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function kstWeekday(iso) { const d = kstShift(iso); return d ? KST_DOW[d.getUTCDay()] : null; }
function kstTimeStr(iso) {
  const d = kstShift(iso);
  if (!d) return null;
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
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
    const nowIso = new Date(now).toISOString();
    const todayNo = kstDayNo(nowIso);
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
      // D-N = KST 달력일 차이. 절대 시간차로 세면 같은 날인데 값이 갈린다.
      const endDayNo = kstDayNo(s.current_period_end);
      const daysToEnd = (endDayNo == null || todayNo == null) ? null : (endDayNo - todayNo);
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
        charge_date_kst: kstDateStr(s.current_period_end),
        charge_weekday_kst: kstWeekday(s.current_period_end),
        charge_time_kst: kstTimeStr(s.current_period_end),
        // 그 날 실제 청구액(월 환산이 아니라 청구서 금액). 연납이면 연 금액.
        charge_amount: (kind === 'trialing' || kind === 'paying' || kind === 'past_due')
          ? (PLAN_PRICE[s.plan] || 0) : 0,
        trial_days: (kind === 'trialing' && days != null) ? Math.round(days) : null,
        paddle_sub_tail: s.paddle_subscription_id ? String(s.paddle_subscription_id).slice(-8) : null,
      };
    });

    const rank = { past_due: 0, trialing: 1, paying: 2, paused: 3, canceled: 4 };
    rows.sort((a, b) => {
      const ra = (rank[a.kind] != null ? rank[a.kind] : 9);
      const rb = (rank[b.kind] != null ? rank[b.kind] : 9);
      if (ra !== rb) return ra - rb;
      // 같은 분류 안에서는 '결제가 임박한 순' — 돈이 언제 움직이는지가 관심사다.
      if (a.kind === b.kind && (a.kind === 'trialing' || a.kind === 'paying')) {
        const da = (a.days_to_period_end == null ? 9999 : a.days_to_period_end);
        const db = (b.days_to_period_end == null ? 9999 : b.days_to_period_end);
        return da - db;
      }
      return 0;
    });

    const summary = {
      paying: 0, trialing: 0, past_due: 0, paused: 0, canceled: 0,
      mrr: 0, standard: 0, premium: 0, trialing_standard: 0, trialing_premium: 0,
      trialing_mrr: 0, mrr_if_all_convert: 0, upcoming: [], now_kst: null,
      currency: PLAN_PRICE_CURRENCY,   // 2026-08-12 — 금액 단위는 EUR 센트다
    };
    for (const r of rows) {
      summary[r.kind] = (summary[r.kind] || 0) + 1;
      if (r.kind === 'paying') {
        summary.mrr += planToMonthly(r.plan);
        if ((r.plan || '').indexOf('standard') > -1) summary.standard += 1;
        else if ((r.plan || '').indexOf('premium') > -1) summary.premium += 1;
      } else if (r.kind === 'trialing') {
        summary.trialing_mrr += planToMonthly(r.plan); // 전부 전환되면 늘어날 월 매출
        if ((r.plan || '').indexOf('standard') > -1) summary.trialing_standard += 1;
        else if ((r.plan || '').indexOf('premium') > -1) summary.trialing_premium += 1;
      }
    }

    summary.mrr_if_all_convert = summary.mrr + summary.trialing_mrr;
    summary.now_kst = kstDateStr(nowIso) + ' ' + kstTimeStr(nowIso);

    // 앞으로 45일 안에 실제로 청구되는 건을 KST 날짜별로 묶는다.
    // first_charge = 체험이 끝나 처음 돈이 빠져나가는 건(= 신규 매출).
    const upMap = {};
    for (const r of rows) {
      if (r.kind !== 'trialing' && r.kind !== 'paying') continue;
      if (!r.charge_date_kst || r.days_to_period_end == null) continue;
      if (r.days_to_period_end < 0 || r.days_to_period_end > 45) continue;
      const k = r.charge_date_kst;
      if (!upMap[k]) {
        upMap[k] = {
          date_kst: k, weekday: r.charge_weekday_kst,
          days_to_charge: r.days_to_period_end, amount: 0, count: 0, first_charge: 0,
        };
      }
      upMap[k].amount += r.charge_amount || 0;
      upMap[k].count += 1;
      if (r.kind === 'trialing') upMap[k].first_charge += 1;
    }
    summary.upcoming = Object.keys(upMap).sort().map((k) => upMap[k]);

    return res.status(200).json({ rows, summary });
  } catch (e) {
    console.error('[admin/subscriptions] error:', e);
    return res.status(500).json({ message: '구독 현황 조회 실패' });
  }
};
