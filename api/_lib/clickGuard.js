/**
 * PAP Magazine — Click-tracking helpers (IP hashing + 24h dedupe).
 *
 * Three responsibilities, factored out of api/go/[id].js so the redirector
 * stays readable AND so tests can exercise the rules without spinning up
 * the full HTTP handler:
 *
 *   1. extractClientIp(req)        — best-effort client IP from Vercel headers
 *   2. hashIp(ip)                  — SHA256(ip + PAP_IP_HASH_SALT) → hex
 *                                    Returns null if the salt env var is
 *                                    unset; api/go/[id].js skips logging in
 *                                    that case (see SPEC §8 PII minimisation
 *                                    + Phase 0 conf option A: "no salt = no log").
 *   3. detectDeviceType(ua)        — mobile / tablet / desktop bucket
 *
 * The 24h-same-IP-same-brand dedupe rule lives at the DB query layer
 * (see api/go/[id].js — index idx_affiliate_clicks_dedup), not here. We
 * keep clickGuard.js pure so dedupe behaviour can be tested with a fake
 * clock instead of a live Postgres.
 */

const crypto = require('crypto');

/**
 * Pull the client IP off a Vercel-deployed Node request. Vercel terminates
 * TLS upstream, so socket.remoteAddress is the proxy, not the visitor.
 * x-forwarded-for is the canonical place; we take the first hop.
 */
function extractClientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  const xri = req.headers['x-real-ip'];
  if (xri) return String(xri).trim();
  const sock = req.socket && req.socket.remoteAddress;
  return sock || '';
}

/**
 * Hash an IP with the deployment salt. Returns null if no salt is
 * configured — the caller (redirector) interprets null as "skip the click
 * insert; the redirect itself still completes". This is Option A in the
 * Phase 0 conf: salt missing = no log, never break the redirect.
 */
function hashIp(ip) {
  const salt = process.env.PAP_IP_HASH_SALT;
  if (!salt) return null;
  if (!ip) return null;
  return crypto
    .createHash('sha256')
    .update(String(ip) + ':' + salt)
    .digest('hex');
}

/**
 * Tablet + mobile detection. Order matters — `iPad` matches both `tablet`
 * and `mobile` regexes, so check tablet first.
 */
function detectDeviceType(uaRaw) {
  const ua = (uaRaw || '').toLowerCase();
  if (!ua) return 'desktop';
  if (/ipad|tablet|playbook|silk(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Trim a referrer URL down to its path-only form. SPEC §2.2 wants the
 * query string dropped (UTM noise + privacy). We also drop the origin so
 * what we store is just `/editorial/foo` style.
 *
 * Defensive about non-URL inputs because admin tooling has occasionally
 * piped in raw paths.
 */
function sanitizeReferrer(refRaw) {
  if (!refRaw) return null;
  const ref = String(refRaw);
  try {
    // URL constructor accepts absolute URLs; throws on bare paths.
    const u = new URL(ref);
    return u.pathname || '/';
  } catch (_) {
    // Already a path? Strip any embedded query string by hand.
    const q = ref.indexOf('?');
    return q > -1 ? ref.slice(0, q) : ref;
  }
}

/**
 * 크롤러/봇 UA 판별 (2026-07-20, 지표 오염 방지).
 *
 * 배경: 7/16 시드 기사 대량 발행 → 사이트맵 갱신 → 크롤러가 SSR 페이지의
 * /api/ig-out 링크를 일제히 따라가며 ig_outclicks 'ssr' 소스가 1000회
 * 스파이크(다음 날 -90%로 복귀). 봇은 리다이렉트만 하고 로그는 남기지
 * 않아야 사람 지표가 오염되지 않는다. 판별은 보수적으로 — 애매하면 사람
 * 취급 (로그 유실보다 허수 소량이 낫다는 방침의 역: 여기선 명백한 봇만 제외).
 */
function isLikelyBot(uaRaw) {
  const ua = String(uaRaw || '');
  if (!ua) return true; // UA 없는 요청은 스크립트로 간주
  return /bot|crawl|spider|slurp|headless|preview|fetch\b|scrape|python|curl\/|wget|httpclient|okhttp|go-http|lighthouse|pingdom|uptime|monitor|facebookexternalhit|whatsapp|telegrambot|embedly|quora link|vkshare|snapchat|pinterestbot/i.test(ua);
}

/**
 * 브라우저가 스스로 붙이는 Fetch Metadata 헤더 (2026-11-15 신설, 마이그레이션 190)
 *
 * ■ 왜
 *   8/17 에 "리퍼러 없는 직접 히트는 세지 않는다"로 크롤러를 걸렀다. 11월의 새
 *   크롤러는 리퍼러를 달고 온다. 실측 10/15~11/13 counted 7,057건 중 3,241건이
 *   매일 00시(UTC) 한 시간에 319~359건씩, IP 전부 다름, 모바일 0건. 이 숫자를
 *   "브랜드 클릭 7배 성장"으로 읽고 수익 계획을 세웠다가 철회했다
 *   (PAP-Vault/45_Business/어필리에이트-현황.md 부록 D).
 *
 * ■ 무엇
 *   사람이 링크를 눌러 이동하면 요즘 브라우저는 이런 헤더를 붙인다:
 *     Sec-Fetch-Site: same-origin · Sec-Fetch-Mode: navigate
 *     Sec-Fetch-Dest: document  · Sec-Fetch-User: ?1   (사용자가 직접 누른 경우만)
 *   UA 와 리퍼러만 흉내 내는 수집기는 대개 이걸 안 붙인다.
 *
 * ■ 지금은 기록만 한다
 *   counted 판정은 건드리지 않는다. 인스타 인앱 브라우저·구형 사파리가 이 헤더를
 *   얼마나 붙이는지 모른다. 모르는 채로 기준에 넣으면 진짜 독자를 버린다.
 *   1주 기록을 보고 기준을 정한다 (같은 실수를 반대 방향으로 하지 않기 위해).
 *
 * 값은 브라우저가 정한 몇 단어뿐이라 허용 목록으로만 받는다. 그 밖은 null.
 */
const FETCH_SITE = new Set(['same-origin', 'same-site', 'cross-site', 'none']);
const FETCH_MODE = new Set(['navigate', 'cors', 'no-cors', 'same-origin', 'websocket']);
const FETCH_DEST = new Set(['document', 'empty', 'iframe', 'image', 'script', 'style', 'font', 'video', 'audio', 'embed', 'object', 'frame', 'worker', 'manifest', 'report']);
function fetchMeta(req) {
  const h = (req && req.headers) || {};
  const pick = (name, allow) => {
    const v = String(h[name] || '').trim().toLowerCase();
    return allow.has(v) ? v : null;
  };
  const userRaw = String(h['sec-fetch-user'] || '').trim();
  return {
    sec_fetch_site: pick('sec-fetch-site', FETCH_SITE),
    sec_fetch_mode: pick('sec-fetch-mode', FETCH_MODE),
    sec_fetch_dest: pick('sec-fetch-dest', FETCH_DEST),
    // 헤더가 아예 없으면 null(모름), '?1' 이면 true, 그 밖(예: '?0')은 false
    sec_fetch_user: userRaw ? userRaw === '?1' : null,
  };
}

/**
 * 클릭 묶음이 크롤러 냄새가 나는지 (2026-11-15)
 *
 * PAP 유입의 대부분은 휴대폰이다. 클릭이 50건 넘게 쌓였는데 휴대폰이 10%도
 * 안 되면 사람이 누른 숫자로 믿지 않는다. channelScorecard 의 인스타 아웃클릭
 * 경보와 같은 기준이다. 표본이 작으면(50 미만) 판단하지 않는다.
 */
const BOT_SUSPECT_MIN_SAMPLE = 50;
const BOT_SUSPECT_MOBILE_SHARE = 0.10;
function clickBotSuspect(total, mobile) {
  const t = Number(total), m = Number(mobile);
  if (!Number.isFinite(t) || !Number.isFinite(m)) return false;
  return t >= BOT_SUSPECT_MIN_SAMPLE && (m / t) < BOT_SUSPECT_MOBILE_SHARE;
}

/** 주간 브리핑에 싣는 한 줄. 숫자만 던지지 않고 믿어도 되는지를 같이 적는다. */
function affiliateClickLine(total, mobile) {
  const t = Number(total) || 0;
  if (mobile === null || mobile === undefined) return String(t);
  const m = Number(mobile) || 0;
  const base = t + ' (그중 휴대폰 ' + m + '건)';
  return clickBotSuspect(t, m)
    ? base + ' ⚠️ 크롤러 의심: 휴대폰 비율 10% 미만. 이 숫자를 성장·수익 신호로 해석하지 말 것. 믿을 수 있는 하한선은 휴대폰 ' + m + '건'
    : base;
}

module.exports = { extractClientIp, hashIp, detectDeviceType, sanitizeReferrer, isLikelyBot, fetchMeta, clickBotSuspect, affiliateClickLine };
