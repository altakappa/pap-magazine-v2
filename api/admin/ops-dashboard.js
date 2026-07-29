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

// ── KST(Asia/Seoul, UTC+9 고정 · 서머타임 없음) 경계 계산 ──────────────
// 왜 필요한가: 아웃클릭 "오늘" 은 운영자가 보는 한국 날짜여야 한다. UTC 로
// 자르면 09:00 KST 에 하루가 바뀌어 오전 수치가 통째로 어제로 새어 나간다.
const KST_OFFSET_MS = 9 * 3600000;
function kstWindows(nowMs) {
  const shifted = new Date(nowMs + KST_OFFSET_MS);
  // shifted 의 UTC 필드 = 실제 KST 벽시계
  const kstMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const todayStart = kstMidnight - KST_OFFSET_MS;          // 오늘 00:00 KST 의 UTC ms
  const yesterdayStart = todayStart - 86400000;
  const elapsed = nowMs - todayStart;                       // 오늘 경과 시간
  const pad = n => String(n).padStart(2, '0');
  return {
    todayStart: new Date(todayStart).toISOString(),
    now: new Date(nowMs).toISOString(),
    yesterdayStart: new Date(yesterdayStart).toISOString(),
    // "어제 같은 시각" — 어제 00:00 부터 오늘 경과분과 똑같은 길이만큼
    yesterdaySameHour: new Date(yesterdayStart + elapsed).toISOString(),
    yesterdayEnd: new Date(todayStart).toISOString(),
    asOfKst: pad(shifted.getUTCHours()) + ':' + pad(shifted.getUTCMinutes()),
    dateKst: shifted.toISOString().slice(0, 10),
  };
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

    // 봇 조회 차단 건수 (최근 7일 합계) — bot_view_blocks(마이그레이션 093).
    // 봇 필터가 editorial_views 오염을 막은 효과를 숫자로 보여주는 관측 지표.
    // 테이블 미배포/오류 시 0 반환(방어적) → 대시보드는 그대로 뜬다.
    const botBlocked7d = await (async () => {
      try {
        const since = ymd(new Date(Date.now() - 7 * 86400000));
        const { data, error } = await A.from('bot_view_blocks')
          .select('blocked_count').gte('day', since);
        if (error || !data) return 0;
        return data.reduce((s, r) => s + (Number(r.blocked_count) || 0), 0);
      } catch (_) { return 0; }
    })();

    // ── 1-b) IG 아웃클릭 — "오늘은 아직 끝나지 않은 하루" 를 명시한다 ──
    //
    // 왜 이 블록이 있나 (2026-07-29 실측) —
    //   아웃클릭이 봇 때문에 부풀었다가(7/25 907회 · 7/26 1352회) 필터가 걸리며
    //   꺼지자 "급감" 오탐이 반복됐다. 게다가 진행 중인 오늘(예: 11시까지 23회)을
    //   완료된 어제(113회)와 그냥 비교하면 매일 아침 "80% 급감" 처럼 보인다.
    //   그래서 (a) 오늘은 부분일임을 플래그로 못박고, (b) 어제 '같은 시각까지'
    //   값을 함께 내려 동일 조건 비교를 가능하게 한다.
    //
    // 봇 판별 보조지표 —
    //   사람 트래픽: 고유 IP 20~60개 × 각 2.5~6회, 모바일 우세.
    //   봇 스파이크: 고유 IP 수백~천 개 × 각 1.x회, 데스크톱 90%+.
    //   따라서 IP당 클릭수와 데스크톱 비율을 같이 보여주면 한눈에 판별된다.
    //   총 건수는 count(head) 로 정확히 세고(row-cap 무관), IP/디바이스 계산용
    //   행만 페이지 단위로 최대 MAX 행까지 받는다. 초과하면 sampled=true 로
    //   표시해 "표본 기준" 임을 숨기지 않는다.
    const outclicks = await (async () => {
      const W = kstWindows(Date.now());
      const between = (from, to) => q => q.gte('clicked_at', from).lt('clicked_at', to);

      const [todayCount, ySameHourCount, yFullCount] = await Promise.all([
        countOf('ig_outclicks', between(W.todayStart, W.now)),
        countOf('ig_outclicks', between(W.yesterdayStart, W.yesterdaySameHour)),
        countOf('ig_outclicks', between(W.yesterdayStart, W.yesterdayEnd)),
      ]);

      // ip_hash / device_type 표본 — PostgREST row-cap(1000) 때문에 페이지로 나눠 받는다.
      const PAGE = 1000, MAX_PAGES = 5;
      const sample = async (from, to) => {
        const seen = new Set();
        let total = 0, desktop = 0, nullIp = 0, truncated = false;
        for (let p = 0; p < MAX_PAGES; p++) {
          let data = [];
          try {
            const r = await A.from('ig_outclicks')
              .select('ip_hash,device_type')
              .gte('clicked_at', from).lt('clicked_at', to)
              .order('clicked_at', { ascending: true })
              .range(p * PAGE, p * PAGE + PAGE - 1);
            if (r.error) break;
            data = r.data || [];
          } catch (_) { break; }
          for (const row of data) {
            total += 1;
            if (row.ip_hash) seen.add(row.ip_hash); else nullIp += 1;
            if (row.device_type === 'desktop') desktop += 1;
          }
          if (data.length < PAGE) break;
          if (p === MAX_PAGES - 1) truncated = true;
        }
        // ip_hash 는 PAP_IP_HASH_SALT 미설정 시 null 로 저장된다 — 그때는
        // 고유 IP 를 셀 수 없으므로 0 이 아니라 null(=미상)로 돌려준다.
        const uniqueIps = (nullIp === total && total > 0) ? null : seen.size;
        return {
          rows: total,
          unique_ips: uniqueIps,
          clicks_per_ip: (uniqueIps && uniqueIps > 0) ? Math.round((total / uniqueIps) * 10) / 10 : null,
          desktop_pct: total > 0 ? Math.round((desktop / total) * 100) : null,
          truncated,
        };
      };

      const [todaySample, ySample] = await Promise.all([
        sample(W.todayStart, W.now),
        sample(W.yesterdayStart, W.yesterdaySameHour),
      ]);

      return {
        outclicks_today: todayCount,
        // 항상 true — 오늘은 정의상 아직 끝나지 않은 하루다. 화면은 이 플래그를
        // 보고 "진행 중" 표기를 붙여 완료된 하루와의 착시 비교를 막는다.
        outclicks_today_partial: true,
        outclicks_yesterday_same_hour: ySameHourCount,
        outclicks_yesterday_full: yFullCount,
        outclicks_as_of_kst: W.asOfKst,
        outclicks_date_kst: W.dateKst,
        outclicks_detail: { today: todaySample, yesterday_same_hour: ySample },
      };
    })();

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
        bot_blocked_7d: botBlocked7d,
      },
      // IG 아웃클릭 — 부분일(오늘) 주의 지표. 키 이름은 화면(ops-dashboard.html)이
      // 그대로 읽는다. outclicks_today_partial 를 무시하고 어제와 직접 비교하지 말 것.
      ...outclicks,
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
