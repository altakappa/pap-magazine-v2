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

module.exports = { extractClientIp, hashIp, detectDeviceType, sanitizeReferrer };
