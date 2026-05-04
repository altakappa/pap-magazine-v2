/**
 * GET /go/:id   (rewritten in vercel.json from /api/go/:id)
 *
 * Affiliate redirector per AFFILIATE_SPEC.md §2:
 *
 *   1. Look up brand by `brand_id` (must be status='active' AND have a URL
 *      for at least one region).
 *   2. Geo-route — KR visitors → affiliate_url_korea (when set),
 *                  everyone else → affiliate_url_global.
 *      Vercel sets `x-vercel-ip-country` for serverless functions; we
 *      fall back to header-only detection (no IP API roundtrip).
 *   3. Record a click in `affiliate_clicks` — PII minimised:
 *        * ip_hash = SHA256(ip + PAP_IP_HASH_SALT)
 *        * referrer with query string stripped
 *        * UA truncated to 100 chars
 *      Dedup rule: same ip_hash × brand × 24h is marked counted=false.
 *      The brand is still redirected — only the analytic counter is gated.
 *   4. 302 redirect with Cache-Control: no-store so an old destination
 *      never sticks in shared caches when admin swaps the affiliate URL.
 *
 * Failure modes (all visit-safe):
 *   - Unknown brand_id  → 302 to home + log
 *   - Brand archived or no usable URL → 302 to home + log
 *   - Click insert errors → swallowed (redirect completes anyway)
 *   - Missing PAP_IP_HASH_SALT → redirect completes; click is NOT logged
 *     (chosen Phase 0 default, see clickGuard.js)
 *
 * Hot path budget per SPEC §13: < 200ms p95.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { extractClientIp, hashIp, detectDeviceType, sanitizeReferrer } = require('../_lib/clickGuard');

const HOME_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const SESSION_TTL_MS  = 24 * 60 * 60 * 1000; // 24h

function pickRegion(req) {
  const country = (req.headers['x-vercel-ip-country']
    || req.headers['cf-ipcountry']
    || req.headers['x-country-code']
    || ''
  ).toString().trim().toUpperCase();
  return country === 'KR' ? 'KR' : 'GLOBAL';
}

function pickAffiliateUrl(brand, region) {
  if (region === 'KR' && brand.affiliate_url_korea) return brand.affiliate_url_korea;
  return brand.affiliate_url_global || brand.affiliate_url_korea || null;
}

/**
 * Same-IP-same-brand-24h check. Returns true if a previous COUNTED click
 * exists in the window — caller will then mark this row counted=false but
 * still record it (so admin can audit dedup behaviour later).
 */
async function isDuplicate(ipHash, brandId, now) {
  if (!ipHash) return false; // no salt → we never dedup; the click isn't logged either
  const since = new Date(now.getTime() - DEDUP_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('affiliate_clicks')
    .select('id')
    .eq('ip_hash', ipHash)
    .eq('brand_id', brandId)
    .eq('counted', true)
    .gte('clicked_at', since)
    .limit(1);
  if (error) {
    console.warn('[go] dedup lookup failed', error.message);
    return false; // fail-open: would rather double-count than block traffic
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Fire-and-forget click record. We DO await it inside the handler so
 * Vercel's serverless runtime doesn't kill the function before the insert
 * finishes — but errors are swallowed so a Postgres hiccup never breaks
 * the redirect for a real visitor.
 */
async function recordClick({ brandId, region, req, now }) {
  const ip = extractClientIp(req);
  const ipHash = hashIp(ip);
  if (!ipHash) {
    // Phase 0 default: no salt → no log. The redirect still completes.
    console.warn('[go] PAP_IP_HASH_SALT unset — click not logged');
    return;
  }

  const ua = String(req.headers['user-agent'] || '');
  const referrer = sanitizeReferrer(req.headers['referer'] || req.headers['referrer']);
  const device = detectDeviceType(ua);

  const counted = !(await isDuplicate(ipHash, brandId, now));

  const sessionId = require('crypto').randomBytes(16).toString('hex');
  const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  const { error } = await supabaseAdmin
    .from('affiliate_clicks')
    .insert({
      brand_id: brandId,
      region: region,
      referrer_path: referrer,
      ip_hash: ipHash,
      user_agent_short: ua.slice(0, 100),
      device_type: device,
      session_id: sessionId,
      session_expires_at: sessionExpiresAt,
      counted: counted,
      // editorial_id + lead_creator_id intentionally null in Phase 0;
      // Phase 1 backfills both via the credit-extraction job.
    });

  if (error) {
    console.warn('[go] click insert failed', error.message);
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  // GET only — POST/etc don't make sense on an affiliate link.
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }
  // Rate-limit the redirector itself. Same `api` preset used elsewhere.
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // Always respond no-store — admin-changed URLs must propagate immediately.
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const brandId = (req.query.id || '').toString().trim();
  if (!brandId) {
    return res.redirect(302, HOME_URL);
  }

  const now = new Date();

  let brand;
  try {
    const { data, error } = await supabaseAdmin
      .from('brands')
      .select('brand_id,status,affiliate_url_global,affiliate_url_korea')
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error) {
      console.error('[go] brand lookup error', error.message);
      return res.redirect(302, HOME_URL);
    }
    brand = data;
  } catch (e) {
    console.error('[go] brand lookup threw', e && e.message);
    return res.redirect(302, HOME_URL);
  }

  if (!brand || brand.status !== 'active') {
    // Unknown / pending / archived → home. Log enough to debug.
    console.warn('[go] no active brand for id=' + brandId + ' (status=' + (brand && brand.status) + ')');
    return res.redirect(302, HOME_URL);
  }

  const region = pickRegion(req);
  const dest = pickAffiliateUrl(brand, region);
  if (!dest) {
    console.warn('[go] no affiliate URL on active brand id=' + brandId);
    return res.redirect(302, HOME_URL);
  }

  // Record click before redirecting. If recording errors, we still redirect.
  try { await recordClick({ brandId, region, req, now }); }
  catch (e) { console.warn('[go] recordClick threw', e && e.message); }

  return res.redirect(302, dest);
};
