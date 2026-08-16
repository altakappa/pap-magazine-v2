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
    /* ── 유입 · 전환 (2026-08-13 신설) ──────────────────────────────────
       왜 여기냐 — 2026-08-12~13 에 만든 계측 세 개(article_views ·
       funnel_events · social_inclicks)가 DB 에만 쌓이고 어드민 어디에도
       안 보였다. 숫자를 만들어 놓고 안 보면 없는 것과 같다.
       모두 count(head) 라 가볍고, 표가 없으면(마이그레이션 전) 0 으로 떨어진다.
       ⚠️ 네이버 애널리틱스 자체 수치는 여기 못 넣는다 — 네이버가 조회 API 를
          일반 제공하지 않는다. 그건 analytics.naver.com 에서 봐야 한다.
          여기 있는 naver 수치는 **우리 자체 계측**(utm 붙은 링크 클릭)이다. */
    /* ⚠️ W(kstWindows)는 위 outclicks 블록 **안에서만** 살아 있다.
       여기서 그대로 쓰면 ReferenceError 다 — node --check 는 이걸 못 잡는다
       (CLAUDE.md 체크리스트의 그 함정). 그래서 여기서 따로 만든다. */
    const WF  = kstWindows(Date.now());
    const D7  = isoDaysAgo(7);
    const D30 = isoDaysAgo(30);
    const [
      artViewsToday, artViews7d, artViews30d,
      subViewToday, subView7d, subView30d,
      inclickRows,
    ] = await Promise.all([
      countOf('article_views', q => q.gte('viewed_at', WF.todayStart)),
      countOf('article_views', q => q.gte('viewed_at', D7)),
      countOf('article_views', q => q.gte('viewed_at', D30)),
      countOf('funnel_events', q => q.eq('step', 'subscribe_view').gte('created_at', WF.todayStart)),
      countOf('funnel_events', q => q.eq('step', 'subscribe_view').gte('created_at', D7)),
      countOf('funnel_events', q => q.eq('step', 'subscribe_view').gte('created_at', D30)),
      rows('social_inclicks', {
        cols: 'src, clicked_at',
        fn: q => q.gte('clicked_at', D30).limit(5000),
      }),
    ]);

    // 채널별 집계 — 7일/30일을 한 번의 조회로 나눈다(요청 수를 늘리지 않는다)
    const srcMap = {};
    for (const r of inclickRows) {
      const key = (r.src || '기타').trim() || '기타';
      if (!srcMap[key]) srcMap[key] = { src: key, d7: 0, d30: 0 };
      srcMap[key].d30 += 1;
      if (r.clicked_at && r.clicked_at >= D7) srcMap[key].d7 += 1;
    }
    const inflow_by_src = Object.values(srcMap).sort((a, b) => b.d30 - a.d30);

    const funnel = {
      article_views_today: artViewsToday,
      article_views_7d: artViews7d,
      article_views_30d: artViews30d,
      subscribe_view_today: subViewToday,
      subscribe_view_7d: subView7d,
      subscribe_view_30d: subView30d,
      active_subs: activeSubs,
      inflow_7d: inflow_by_src.reduce((n, r) => n + r.d7, 0),
      inflow_30d: inflow_by_src.reduce((n, r) => n + r.d30, 0),
      inflow_by_src,
    };

    /* ── IG 성과 · 도달이 아니라 공유율 (2026-08-16 신설) ────────────────
     *
     * 왜 도달을 대표 숫자로 두지 않나 — 30일 실측이 답한다.
     *   2026-07-29  도달 1,609,308 · 좋아요 212,260 · 공유 22,518 · 팔로우   170
     *   2026-08-11  도달   616,522 · 좋아요  34,841 · 공유 36,323 · 팔로우 1,091
     * 도달을 4배 더 한 쪽이 팔로워는 6분의 1이었다(전환 0.011% vs 0.177%, 16배).
     * 도달은 결과지 목표가 아니다. 두 건이 갈린 유일한 지표가 **공유**였다.
     * 공유는 인스타가 비팔로워에게 밀어주는 신호이고, 성장 헌법 6항과도 안
     * 부딪힌다 — 맞팔·이벤트로 좋아요는 만들 수 있어도 공유는 못 만든다.
     *
     * 그리고 평균을 쓰지 않는다. 캐러셀 도달 평균 29,270 · 중앙값 9,596 —
     * 두 편이 만든 착시다. 중앙값과 함께 보여준다.
     *
     * `blind` 가 이 카드의 핵심이다. 영상 49편 전부 전환 지표가 NULL 인 걸
     * 한 달 동안 아무도 몰랐다. 안 보이는 건수를 화면에 띄운다. */
    const igRows = await rows('ig_post_metric', {
      cols: 'post_id, permalink, media_type, posted_at, captured_at, reach, shares, saved, follows',
      fn: q => q.gte('posted_at', D30).order('captured_at', { ascending: false }).limit(6000),
    });
    // 게시물당 가장 최근 캡처 1건만 — 같은 게시물이 3시간마다 여러 행으로 쌓인다
    const igLatest = new Map();
    for (const r of igRows) if (r && r.post_id && !igLatest.has(r.post_id)) igLatest.set(r.post_id, r);
    const igPosts = [...igLatest.values()].filter(r => Number(r.reach) > 0);

    const median = (arr) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    };
    const sum = (f) => igPosts.reduce((n, r) => n + (Number(r[f]) || 0), 0);
    const rate = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0);   // %, 소수 2자리

    const igMeasured = igPosts.filter(r => r.follows !== null && r.follows !== undefined);
    const ig_perf = {
      posts: igPosts.length,
      reach_30d: sum('reach'),
      reach_median: median(igPosts.map(r => Number(r.reach) || 0)),
      shares_30d: sum('shares'),
      share_rate: rate(sum('shares'), sum('reach')),          // ← 이게 대표 지표다
      follow_rate: rate(
        igMeasured.reduce((n, r) => n + (Number(r.follows) || 0), 0),
        igMeasured.reduce((n, r) => n + (Number(r.reach) || 0), 0)),
      follows_measured_posts: igMeasured.length,
      blind_posts: igPosts.length - igMeasured.length,        // ← 안 보이는 건수
      blind_reach: igPosts.filter(r => r.follows === null || r.follows === undefined)
        .reduce((n, r) => n + (Number(r.reach) || 0), 0),
      // 도달이 아니라 공유율 순으로 줄 세운다 — 무엇을 더 만들지의 근거
      top_by_share_rate: igPosts
        .filter(r => Number(r.reach) >= 3000)                 // 표본이 작으면 비율이 튄다
        .map(r => ({
          permalink: r.permalink, media_type: r.media_type,
          posted_at: r.posted_at, reach: Number(r.reach) || 0,
          shares: Number(r.shares) || 0, follows: r.follows,
          share_rate: rate(Number(r.shares) || 0, Number(r.reach) || 0),
        }))
        .sort((a, b) => b.share_rate - a.share_rate)
        .slice(0, 8),
    };

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
      funnel,
      ig_perf,
    });
  } catch (e) {
    console.error('[ops-dashboard] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
