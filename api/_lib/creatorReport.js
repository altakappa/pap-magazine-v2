/**
 * 크리에이터 성적표·월간 소식의 순수 규칙 — api/_lib/creatorReport.js (2026-09-24)
 *
 * 도메니코 "세 조각 설정해줘" ②·③. DB 를 부르지 않는 함수만 둔다.
 * 크론(api/cron/creator-report-card.js · creator-monthly.js)과
 * 테스트(tests/creator-mail.test.js)가 같은 규칙을 쓴다.
 */
'use strict';

const REPORT_MIN_DAYS = 14;   // 게재 2주 뒤부터 (인스타 반응이 거의 다 쌓인 시점)
const REPORT_MAX_DAYS = 45;   // 너무 오래된 화보는 보내지 않는다 (소급 폭탄 방지)
const MIN_WEB_VIEWS = 20;     // 인스타 숫자가 없고 웹 조회도 이보다 적으면 보내지 않는다
const MAX_ATTEMPTS = 3;

function daysSince(dateStr, now) {
  const t = Date.parse(String(dateStr || '').slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(t)) return null;
  return Math.floor(((now || Date.now()) - t) / 86400000);
}

/** 성적표를 보낼 차례인가 (한 화보에 한 번). */
function isReportDue(ed, now) {
  if (!ed || ed.status !== 'published') return false;
  if (!ed.source_submission_id) return false;
  if (ed.report_card_sent_at) return false;
  if ((ed.report_card_attempts || 0) >= MAX_ATTEMPTS) return false;
  const d = daysSince(ed.published_date, now);
  return d !== null && d >= REPORT_MIN_DAYS && d <= REPORT_MAX_DAYS;
}

/** 한 화보에 인스타 게시물이 여러 개면 도달이 가장 큰 것 하나를 쓴다. */
function pickIgMetrics(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && Number(r.reach) > 0);
  if (!list.length) return null;
  list.sort((a, b) => Number(b.reach) - Number(a.reach));
  const r = list[0];
  return {
    reach: Number(r.reach) || 0,
    likes: Number(r.like_count) || 0,
    saved: Number(r.saved) || 0,
    shares: Number(r.shares) || 0,
    capturedAt: r.captured_at || null,
  };
}

/** 보낼 만한 숫자가 있는가. 초라한 숫자만 있는 메일은 오히려 의욕을 꺾는다. */
function worthSending(ig, webViews) {
  if (ig && ig.reach > 0) return true;
  return Number(webViews || 0) >= MIN_WEB_VIEWS;
}

/** 지난달 범위 (UTC). now 가 10/1 이면 9/1 ~ 10/1. */
function previousMonth(now) {
  const d = new Date(now || Date.now());
  const y = d.getUTCFullYear(), m = d.getUTCMonth();   // m: 이번 달 0-based
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const key = start.toISOString().slice(0, 7);
  return { key, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** 'YYYY-MM' 을 받아 범위로. 잘못된 값이면 null. */
function monthRange(key) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(key || ''))) return null;
  const [y, m] = key.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { key, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** 월간 소식 payload. items 는 도달 큰 순 상위 6개, 합계는 전체로 센다. */
function buildMonthlyPayload(monthKey, editorials) {
  const list = (Array.isArray(editorials) ? editorials : []).map((e) => ({
    id: e.id,
    slug: e.slug || '',
    title: e.title || '',
    title_en: e.title_en || '',
    image: e.cover_image || e.thumbnail || '',
    reach: (e.ig && e.ig.reach) || 0,
  }));
  const totalReach = list.reduce((a, x) => a + x.reach, 0);
  const items = list.filter((x) => x.slug && x.image)
    .sort((a, b) => b.reach - a.reach).slice(0, 6);
  return { audience: 'creators', month: monthKey, totals: { n: list.length, reach: totalReach }, items };
}

function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }

function monthLabel(key, localeTag) {
  const r = monthRange(key);
  if (!r) return String(key || '');
  try {
    return new Date(r.start + 'T00:00:00Z').toLocaleString(localeTag || 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch (_) { return key; }
}

module.exports = {
  REPORT_MIN_DAYS, REPORT_MAX_DAYS, MIN_WEB_VIEWS, MAX_ATTEMPTS,
  daysSince, isReportDue, pickIgMetrics, worthSending,
  previousMonth, monthRange, buildMonthlyPayload, fill, fmtNum, monthLabel,
};
