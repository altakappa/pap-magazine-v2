'use strict';
/**
 * 구독 출처별 전환 장부 (2026-10-02, 도메니코 "측정 자동화 응").
 *
 * 왜: 10/1~10/2 에 구독 페이지로 보내는 문이 여럿 생겼다(화보 공개 메일 live_mail, 화보 페이지 다운로드 칸
 *     editorial_downloads, 캐스팅 콜 티저 casting_teaser, 인증서 링크 mypage_certificate, 잠금 팝업 lp_a/lp_b …).
 *     subscribe_view 가 path 에 ?utm_source= 를 남기지만(10/1), 그 사람이 결제했는지는 매번 SQL 로 물어야 했다.
 * 무엇: 기간 안의 subscribe_view 를 utm_source 별로 세고, 같은 기간에 생긴 구독(subscriptions.created_at)을
 *     "결제 전 14일 안의 마지막 subscribe_view(로그인 상태)" 의 utm 에 귀속시킨다. 로그인 안 한 조회는 귀속 불가 →
 *     '귀속 불가' 로 따로 센다. 잠금 팝업 A/B 는 노출/클릭을 변형별로.
 * 정직: 숫자가 작다. 표는 "어디서 왔는가" 를 보여줄 뿐, 차이가 통계적으로 의미 있다고 말하지 않는다.
 */
/* supabase 는 함수 안에서 늦게 읽는다 — 테스트가 순수 함수(aggregate·render)만 불러도 되게. */

const ATTRIB_WINDOW_DAYS = 14;

function utmOf(path) {
  const m = /[?&]utm_source=([a-z0-9_]{1,40})/i.exec(String(path || ''));
  return m ? m[1].toLowerCase() : '(없음)';
}
function lpOf(path) {
  const m = /[?&]lp=([ab])\b/i.exec(String(path || ''));
  return m ? m[1].toLowerCase() : '-';
}

/** 순수 집계 — DB 없이 테스트 가능. events: funnel_events 행, subs: subscriptions 행 */
function aggregate(events, subs, nowMs) {
  const now = nowMs || Date.now();
  const bySrc = {};
  const touch = (k) => (bySrc[k] = bySrc[k] || { source: k, views: 0, users: new Set(), purchases: 0, yearly: 0 });
  const viewsByUser = {};
  const popup = { a: { views: 0, cta: 0 }, b: { views: 0, cta: 0 }, '-': { views: 0, cta: 0 } };
  for (const e of events || []) {
    if (e.step === 'subscribe_view') {
      const src = utmOf(e.path); const r = touch(src); r.views += 1;
      if (e.user_id) { r.users.add(e.user_id); (viewsByUser[e.user_id] = viewsByUser[e.user_id] || []).push({ t: Date.parse(e.created_at), src }); }
    } else if (e.step === 'locked_popup_view' || e.step === 'locked_popup_cta') {
      const v = lpOf(e.path); const p = popup[v] || popup['-'];
      if (e.step === 'locked_popup_view') p.views += 1; else p.cta += 1;
    }
  }
  let unattributed = 0, total = 0;
  for (const s of subs || []) {
    total += 1;
    const t = Date.parse(s.created_at);
    const list = (s.user_id && viewsByUser[s.user_id]) || [];
    let best = null;
    for (const v of list) if (v.t <= t && t - v.t <= ATTRIB_WINDOW_DAYS * 86400000 && (!best || v.t > best.t)) best = v;
    if (!best) { unattributed += 1; continue; }
    const r = touch(best.src); r.purchases += 1;
    if (/_yearly$|_annual$/i.test(String(s.plan || '')) || String(s.billing_cycle || '') === 'yearly') r.yearly += 1;
  }
  const rows = Object.values(bySrc).map((r) => ({ source: r.source, views: r.views, users: r.users.size, purchases: r.purchases, yearly: r.yearly }))
    .sort((a, b) => b.purchases - a.purchases || b.views - a.views);
  return { rows, totalPurchases: total, unattributed, popup, generatedAt: new Date(now).toISOString() };
}

async function buildSubscribeFunnel({ days = 28 } = {}) {
  const { supabaseAdmin } = require('./supabase');
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sinceEv = new Date(Date.now() - (days + ATTRIB_WINDOW_DAYS) * 86400000).toISOString();
  const [ev, subs] = await Promise.all([
    supabaseAdmin.from('funnel_events').select('step, path, user_id, created_at')
      .in('step', ['subscribe_view', 'locked_popup_view', 'locked_popup_cta']).gte('created_at', sinceEv).limit(20000),
    supabaseAdmin.from('subscriptions').select('user_id, plan, billing_cycle, created_at').gte('created_at', since).limit(2000),
  ]);
  if (ev.error) throw ev.error;
  if (subs.error) throw subs.error;
  // 조회·팝업은 기간(days) 안의 것만 센다. 결제 귀속은 결제 전 14일까지의 조회를 본다.
  const evAll = ev.data || [];
  const inWin = aggregate(evAll.filter((e) => e.created_at >= since), [], Date.now());
  const attr = aggregate(evAll, subs.data || [], Date.now());
  const merged = {};
  for (const r of inWin.rows) merged[r.source] = { source: r.source, views: r.views, users: r.users, purchases: 0, yearly: 0 };
  for (const r of attr.rows) {
    if (!r.purchases) continue;
    merged[r.source] = merged[r.source] || { source: r.source, views: 0, users: 0, purchases: 0, yearly: 0 };
    merged[r.source].purchases = r.purchases; merged[r.source].yearly = r.yearly;
  }
  const rows = Object.values(merged).sort((a, b) => b.purchases - a.purchases || b.views - a.views);
  return { days, rows, totalPurchases: attr.totalPurchases, unattributed: attr.unattributed, popup: inWin.popup, generatedAt: inWin.generatedAt };
}

function pct(n, d) { return d ? (Math.round((n / d) * 1000) / 10) + '%' : '-'; }

function renderSubscribeFunnelMd(f) {
  if (!f || !Array.isArray(f.rows)) return '';
  const lines = [];
  lines.push('## 구독 출처별 전환 (' + (f.days || 28) + '일)');
  lines.push('구독 페이지 조회(utm_source) → 같은 사람이 14일 안에 결제. 로그인 안 한 조회는 결제에 못 묶는다. 표본이 작으니 순위만 보고 결론은 내리지 말 것.');
  lines.push('');
  lines.push('| 출처 | 조회 | 로그인 사용자 | 결제 | 연간 | 사용자→결제 |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const r of f.rows) lines.push('| ' + r.source + ' | ' + r.views + ' | ' + r.users + ' | ' + r.purchases + ' | ' + r.yearly + ' | ' + pct(r.purchases, r.users) + ' |');
  lines.push('');
  lines.push('결제 합계 ' + (f.totalPurchases || 0) + '건 · 출처에 못 묶은 결제 ' + (f.unattributed || 0) + '건(비로그인 조회 또는 14일 밖).');
  const p = f.popup || {};
  const a = p.a || { views: 0, cta: 0 }, b = p.b || { views: 0, cta: 0 };
  if (a.views || b.views) {
    lines.push('');
    lines.push('잠금 팝업 A/B: A 노출 ' + a.views + ' · 클릭 ' + a.cta + ' (' + pct(a.cta, a.views) + ') / B 노출 ' + b.views + ' · 클릭 ' + b.cta + ' (' + pct(b.cta, b.views) + ')');
  }
  return lines.join('\n');
}

module.exports = { buildSubscribeFunnel, renderSubscribeFunnelMd, aggregate, utmOf, lpOf, ATTRIB_WINDOW_DAYS };
