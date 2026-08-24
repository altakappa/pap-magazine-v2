/**
 * GET /api/admin/stats — Single source of truth for the admin home dashboard.
 *
 * Returns:
 *  - totals          : member / editorial / submission / pullletter / community counts
 *  - planCounts      : breakdown of active subscriptions by plan
 *  - monthlyRevenue  : estimated MRR (EUR 센트, 월정액 + 연정액을 1/12 로 환산)
 *  - thisMonth       : new members / editorials / submissions / pullletters this month
 *  - recentMembers   : 5 most recently joined profiles
 *  - recentEditorials: 5 most recently published editorials
 *  - recentSubmissions : 5 most recently submitted (with status, submitter)
 *  - pullletterTrend : 30-day daily pull-letter signup count
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

// 🔴 2026-08-12 — EUR 센트. 원화 가격표(8500/85000/13500/135000)를 쓰고 있었다.
//
// Paddle(MoR) 을 떠나 PayPal 로 오면서 구독가를 EUR 단일가로 합쳤는데, 어드민 매출
// 계산만 원화 표에 남아 있었다. 환산 코드도 없어서 화면의 "₩8,500" 은 어떤 환율로도
// 맞을 수 없는 숫자였다. 8/14 에 Paddle 대시보드가 닫히면 어드민이 유일한 장부다.
//
// ⚠️ frontend/subscribe.html 의 EUR_PRICES 와 반드시 같은 값을 쓸 것.
//    tests/subscription-price-single-source.test.js 가 그 일치를 고정한다.
const PLAN_PRICE = {
  standard_monthly: 549,
  standard_yearly: 4599,
  premium_monthly: 899,
  premium_yearly: 7499,
};
const PLAN_PRICE_CURRENCY = 'EUR';

// 2026-08-24 (도메니코 지적) — 유료 유형(branded 등)인데 결제 승인을 안 마친
// 서브미션("Red spot without shadow", awaiting_authorization)이 홈 대시보드
// '최근 서브미션' 위젯에 '대기 중'으로 떴다. 8/17 결제 필터는 목록 엔드포인트
// (api/submissions/index.js)에만 붙었고, 이 위젯은 여기(stats)의 별도 쿼리를
// 쓰기 때문이다. 같은 필터를 최근 5건과 pending 카운트 배지에 동일 적용한다.
// NULL(결제 컬럼 도입 전 과거 행)은 살린다 — index.js 와 문자열까지 동일할 것.
const PAYMENT_VISIBLE_OR =
  'payment_status.is.null,payment_status.not.in.(awaiting_authorization,awaiting_payment)';

// Annualized → monthly conversion for MRR
function planToMonthly(plan) {
  const price = PLAN_PRICE[plan] || 0;
  if (plan && plan.endsWith('_yearly')) return Math.round(price / 12);
  return price;
}

function startOfThisMonthISO() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfDayUTC(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const monthStart = startOfThisMonthISO();
    const trendStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel
    const [
      memTotal,
      edTotal,
      subPending,
      plPending,
      cpTotal,
      activeSubs,
      memThisMonth,
      edThisMonth,
      subThisMonth,
      plThisMonth,
      recentMem,
      recentEd,
      recentSub,
      plTrend,
      filmTotal,
      newsTotal,
      filmThisMonth,
      newsThisMonth,
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('editorials').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      supabaseAdmin.from('submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending').or(PAYMENT_VISIBLE_OR),
      supabaseAdmin.from('pullletters').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('community_posts').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('subscriptions').select('plan, current_period_start, current_period_end').eq('status', 'active'),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabaseAdmin.from('editorials').select('*', { count: 'exact', head: true }).eq('status', 'published').gte('published_date', monthStart),
      supabaseAdmin.from('submissions').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabaseAdmin.from('pullletters').select('*', { count: 'exact', head: true }).gte('subscribed_at', monthStart),
      supabaseAdmin.from('profiles').select('id, display_name, email, avatar_url, role, created_at').order('created_at', { ascending: false }).limit(5),
      supabaseAdmin.from('editorials').select('id, title, slug, thumbnail, cover_image, published_date, status').eq('status', 'published').order('published_date', { ascending: false }).limit(5),
      supabaseAdmin.from('submissions').select('*').or(PAYMENT_VISIBLE_OR).order('created_at', { ascending: false }).limit(5),
      supabaseAdmin.from('pullletters').select('subscribed_at').gte('subscribed_at', trendStart),
      // 게시된 필름/기사 (에디토리얼 카드와 동일 규칙: status='published').
      supabaseAdmin.from('films').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      supabaseAdmin.from('articles').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      supabaseAdmin.from('films').select('*', { count: 'exact', head: true }).eq('status', 'published').gte('published_date', monthStart),
      supabaseAdmin.from('articles').select('*', { count: 'exact', head: true }).eq('status', 'published').gte('published_date', monthStart),
    ]);

    // Plan breakdown + MRR
    // 2026-08-02 — 무료 체험(Paddle trialing) 구독은 매출/유료 집계에서 제외.
    // Paddle webhook 이 trialing→'active' 로 저장(열람권한용)하므로, 현재 청구주기
    // 길이로 구분: PAP 유료 주기는 월(~30일)·연(~365일)뿐이라 10일 미만이면 체험(7일).
    const planCounts = { free: 0, standard_monthly: 0, standard_yearly: 0, premium_monthly: 0, premium_yearly: 0 };
    const trialCounts = { standard_monthly: 0, standard_yearly: 0, premium_monthly: 0, premium_yearly: 0 };
    let mrr = 0;
    let payingSubs = 0;
    let trialingSubs = 0;
    if (Array.isArray(activeSubs.data)) {
      for (const row of activeSubs.data) {
        const plan = row.plan || 'free';
        let isTrial = false;
        if (row.current_period_start && row.current_period_end) {
          const days = (new Date(row.current_period_end) - new Date(row.current_period_start)) / 86400000;
          if (days > 0 && days < 10) isTrial = true;
        }
        if (isTrial) {
          trialingSubs += 1;
          trialCounts[plan] = (trialCounts[plan] || 0) + 1;
          continue;
        }
        payingSubs += 1;
        planCounts[plan] = (planCounts[plan] || 0) + 1;
        mrr += planToMonthly(plan);
      }
    }
    const standardCount = planCounts.standard_monthly + planCounts.standard_yearly;
    const premiumCount = planCounts.premium_monthly + planCounts.premium_yearly;
    const trialStandard = trialCounts.standard_monthly + trialCounts.standard_yearly;
    const trialPremium = trialCounts.premium_monthly + trialCounts.premium_yearly;

    // Hydrate recent submissions with submitter profile (mirrors list endpoint)
    let recentSubmissions = [];
    if (Array.isArray(recentSub.data) && recentSub.data.length) {
      const ids = Array.from(new Set(recentSub.data.map(s => s.user_id).filter(Boolean)));
      let profById = {};
      if (ids.length) {
        const { data: profs } = await supabaseAdmin
          .from('profiles')
          .select('id, display_name, email')
          .in('id', ids);
        if (Array.isArray(profs)) profs.forEach(p => { profById[p.id] = p; });
      }
      recentSubmissions = recentSub.data.map(s => {
        const p = profById[s.user_id] || {};
        return {
          ...s,
          submitterName: p.display_name || null,
          submitterEmail: p.email || null,
        };
      });
    }

    // Pull-letter trend: bucketize last 30 days
    const trendDays = 30;
    const trendBuckets = [];
    const today = startOfDayUTC(new Date());
    for (let i = trendDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      trendBuckets.push({ date: d.toISOString().slice(0, 10), count: 0 });
    }
    if (Array.isArray(plTrend.data)) {
      const idxByDate = Object.fromEntries(trendBuckets.map((b, i) => [b.date, i]));
      for (const row of plTrend.data) {
        if (!row.subscribed_at) continue;
        const key = row.subscribed_at.slice(0, 10);
        const i = idxByDate[key];
        if (typeof i === 'number') trendBuckets[i].count += 1;
      }
    }

    return res.status(200).json({
      totals: {
        members: memTotal.count || 0,
        editorialsPublished: edTotal.count || 0,
        filmsPublished: filmTotal.count || 0,
        newsPublished: newsTotal.count || 0,
        submissionsPending: subPending.count || 0,
        pullettersPending: plPending.count || 0,
        communityPosts: cpTotal.count || 0,
        activeSubscriptions: payingSubs,
        trialingSubscriptions: trialingSubs,
      },
      planCounts: {
        ...planCounts,
        standard: standardCount,
        premium: premiumCount,
      },
      trialing: {
        count: trialingSubs,
        standard: trialStandard,
        premium: trialPremium,
      },
      monthlyRevenue: mrr,                       // EUR 센트
      monthlyRevenueCurrency: PLAN_PRICE_CURRENCY,
      thisMonth: {
        members: memThisMonth.count || 0,
        editorials: edThisMonth.count || 0,
        films: filmThisMonth.count || 0,
        news: newsThisMonth.count || 0,
        submissions: subThisMonth.count || 0,
        pullletters: plThisMonth.count || 0,
      },
      recentMembers: recentMem.data || [],
      recentEditorials: recentEd.data || [],
      recentSubmissions,
      pullletterTrend: trendBuckets,
    });
  } catch (error) {
    try {
      console.error('Admin stats error:', {
        name: error && error.name,
        message: error && error.message,
        code: error && error.code,
        details: error && error.details,
        hint: error && error.hint,
      });
    } catch (_) { console.error('Admin stats error (raw):', error); }

    const parts = [];
    if (error && error.message) parts.push(String(error.message));
    if (error && error.code) parts.push('code=' + error.code);
    if (error && error.details) parts.push(String(error.details).slice(0, 120));
    const hint = parts.join(' | ').slice(0, 300);
    return res.status(500).json({
      message: 'Failed to fetch stats' + (hint ? ` — ${hint}` : ''),
    });
  }
};
