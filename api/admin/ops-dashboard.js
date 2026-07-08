/**
 * GET /api/admin/ops-dashboard — PAP 매거진 운영 현황 대시보드 (관리자 전용).
 *
 * 사이트 Supabase DB에서 발행/트래픽/회원/투고 지표를 집계해 한 번에 반환한다.
 * 모든 수치는 count(head) 쿼리 또는 소량 limit 조회만 사용 — 대량 row fetch가
 * 없어 PostgREST row-cap(기본 1000) 이슈가 발생하지 않는다.
 *
 * 반환 JSON:
 *   {
 *     generated_at, kpi:{...}, submissions:{...},
 *     monthly:[{label,count}...], daily:[{label,count}...],
 *     recent_editorials:[...], top_editorials:[...],
 *     recent_articles:[...], pending_submissions:[...],
 *     issues:[...], article_categories:[{category,count}...]
 *   }
 *
 * 소비자: frontend/ops-dashboard.html  (rewrite: /ops-dashboard)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  const A = supabaseAdmin;

  // head:true → row 데이터 없이 count 만 받아온다 (가볍고 row-cap 무관).
  const countOf = async (table, build) => {
    try {
      let q = A.from(table).select('*', { count: 'exact', head: true });
      if (build) q = build(q);
      const { count, error } = await q;
      if (error) return 0;
      return count || 0;
    } catch (_) {
      return 0;
    }
  };
  const rows = async (table, build) => {
    try {
      let q = A.from(table).select(build.cols);
      q = build.fn(q);
      const { data, error } = await q;
      if (error) return [];
      return data || [];
    } catch (_) {
      return [];
    }
  };

  try {
    // ── 1) KPI count 지표 ──────────────────────────────────────────────
    const [
      edPub, edDraft, artCount, filmCount,
      profTotal, profWeek, creators, activeSubs, pepperit, campaigns,
      viewsTotal, views7d, views30d,
    ] = await Promise.all([
      countOf('editorials', q => q.eq('status', 'published')),
      countOf('editorials', q => q.eq('status', 'draft')),
      countOf('articles',   q => q.eq('status', 'published')),
      countOf('films',      q => q.eq('status', 'published')),
      countOf('profiles'),
      countOf('profiles',   q => q.gte('created_at', isoDaysAgo(7))),
      countOf('profiles',   q => q.eq('is_creator', true)),
      countOf('subscriptions', q => q.eq('status', 'active')),
      countOf('pepperit_articles'),
      countOf('email_campaigns'),
      countOf('editorial_views'),
      countOf('editorial_views', q => q.gte('viewed_at', isoDaysAgo(7))),
      countOf('editorial_views', q => q.gte('viewed_at', isoDaysAgo(30))),
    ]);

    // ── 2) 투고(submissions) 상태별 ────────────────────────────────────
    const subKeys = ['pending', 'revision', 'approved', 'rejected'];
    const subVals = await Promise.all(subKeys.map(s => countOf('submissions', q => q.eq('status', s))));
    const submissions = { total: 0 };
    subKeys.forEach((k, i) => { submissions[k] = subVals[i]; submissions.total += subVals[i]; });

    // ── 3) 월별 에디토리얼 발행 (최근 12개월, published_date 기준) ──────
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
      months.push({ label: (start.getUTCMonth() + 1) + '월', start: ymd(start), end: ymd(end) });
    }
    await Promise.all(months.map(async m => {
      m.count = await countOf('editorials', q =>
        q.eq('status', 'published').gte('published_date', m.start).lt('published_date', m.end));
      delete m.start; delete m.end;
    }));

    // ── 4) 일별 조회수 (최근 30일, editorial_views 기준) ───────────────
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      const d1 = new Date(d0.getTime() + 86400000);
      days.push({ label: (d0.getUTCMonth() + 1) + '/' + d0.getUTCDate(), s: d0.toISOString(), e: d1.toISOString() });
    }
    await Promise.all(days.map(async dy => {
      dy.count = await countOf('editorial_views', q => q.gte('viewed_at', dy.s).lt('viewed_at', dy.e));
      delete dy.s; delete dy.e;
    }));

    // ── 5) 리스트 (모두 limit ≤ 12 → row-cap 무관) ─────────────────────
    const [
      recentEditorials, topEditorials, recentArticles,
      pendingSubs, issues, artCatRows,
    ] = await Promise.all([
      rows('editorials', { cols: 'title,slug,published_date,view_count,issue',
        fn: q => q.eq('status', 'published').order('published_date', { ascending: false, nullsFirst: false }).limit(12) }),
      rows('editorials', { cols: 'title,slug,view_count',
        fn: q => q.eq('status', 'published').order('view_count', { ascending: false, nullsFirst: false }).limit(8) }),
      rows('articles', { cols: 'title,published_date',
        fn: q => q.eq('status', 'published').order('published_date', { ascending: false, nullsFirst: false }).limit(8) }),
      rows('submissions', { cols: 'title,status,created_at',
        fn: q => q.in('status', ['pending', 'revision']).order('created_at', { ascending: false }).limit(8) }),
      rows('magazine_issues', { cols: 'issue_number,title,month_label,editorial_count,is_latest',
        fn: q => q.order('issue_number', { ascending: false }).limit(6) }),
      rows('articles', { cols: 'category',
        fn: q => q.eq('status', 'published').not('category', 'is', null).limit(1000) }),
    ]);

    // 기사 카테고리 집계 (JS 측 tally)
    const catMap = {};
    for (const r of artCatRows) {
      const c = (r.category || '').trim();
      if (!c) continue;
      catMap[c] = (catMap[c] || 0) + 1;
    }
    const article_categories = Object.entries(catMap)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      kpi: {
        editorials_published: edPub,
        editorials_draft: edDraft,
        articles: artCount,
        films: filmCount,
        members: profTotal,
        members_week: profWeek,
        creators,
        active_subs: activeSubs,
        pepperit,
        campaigns,
        views_total: viewsTotal,
        views_7d: views7d,
        views_30d: views30d,
      },
      submissions,
      monthly: months,
      daily: days,
      recent_editorials: recentEditorials,
      top_editorials: topEditorials,
      recent_articles: recentArticles,
      pending_submissions: pendingSubs,
      issues,
      article_categories,
    });
  } catch (e) {
    console.error('[ops-dashboard] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
