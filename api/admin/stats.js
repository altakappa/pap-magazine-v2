/**
 * GET /api/admin/stats — Single source of truth for the admin home dashboard.
 *
 * Returns:
 *  - totals          : member / editorial / submission / pullletter / community counts
 *  - planCounts      : breakdown of active subscriptions by plan
 *  - monthlyRevenue  : estimated MRR (₩, monthly + amortized yearly)
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

// Plan prices in ₩ — must match api/subscriptions/checkout.js
const PLAN_PRICE = {
  standard_monthly: 8500,
  standard_yearly: 85000,
  premium_monthly: 13500,
  premium_yearly: 135000,
};

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
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('editorials').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      supabaseAdmin.from('submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('pullletters').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('community_posts').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('subscriptions').select('plan').eq('status', 'active'),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabaseAdmin.from('editorials').select('*', { count: 'exact', head: true }).eq('status', 'published').gte('published_date', monthStart),
      supabaseAdmin.from('submissions').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabaseAdmin.from('pullletters').select('*', { count: 'exact', head: true }).gte('subscribed_at', monthStart),
      supabaseAdmin.from('profiles').select('id, display_name, email, avatar_url, role, created_at').order('created_at', { ascending: false }).limit(5),
      supabaseAdmin.from('editorials').select('id, title, slug, thumbnail, cover_image, published_date, status').eq('status', 'published').order('published_date', { ascending: false }).limit(5),
      supabaseAdmin.from('submissions').select('*').order('created_at', { ascending: false }).limit(5),
      supabaseAdmin.from('pullletters').select('subscribed_at').gte('subscribed_at', trendStart),
    ]);

    // Plan breakdown + MRR
    const planCounts = { free: 0, standard_monthly: 0, standard_yearly: 0, premium_monthly: 0, premium_yearly: 0 };
    let mrr = 0;
    if (Array.isArray(activeSubs.data)) {
      for (const row of activeSubs.data) {
        const plan = row.plan || 'free';
        planCounts[plan] = (planCounts[plan] || 0) + 1;
        mrr += planToMonthly(plan);
      }
    }
    const standardCount = planCounts.standard_monthly + planCounts.standard_yearly;
    const premiumCount = planCounts.premium_monthly + planCounts.premium_yearly;

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
        submissionsPending: subPending.count || 0,
        pullettersPending: plPending.count || 0,
        communityPosts: cpTotal.count || 0,
        activeSubscriptions: Array.isArray(activeSubs.data) ? activeSubs.data.length : 0,
      },
      planCounts: {
        ...planCounts,
        standard: standardCount,
        premium: premiumCount,
      },
      monthlyRevenue: mrr,
      thisMonth: {
        members: memThisMonth.count || 0,
        editorials: edThisMonth.count || 0,
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
