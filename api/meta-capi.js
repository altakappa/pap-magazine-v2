/**
 * PAP Magazine — Meta Conversions API (CAPI) Endpoint
 *
 * Server-side companion to the browser Meta Pixel. Sends the same events
 * directly from PAP's Vercel server to Meta, bypassing ad-blockers,
 * iOS 14.5+ tracking restrictions, and Safari ITP. Meta automatically
 * deduplicates Pixel + CAPI events that share the same `event_id`.
 *
 * Coverage with Pixel only:  ~50–70% of users
 * Coverage with Pixel + CAPI: ~95–100% of users
 *
 * Required environment variables (set in Vercel → Project → Settings → Env):
 *   META_PIXEL_ID            — 482856832429283 (PAPMAGAZINE Pixel)
 *   META_CAPI_ACCESS_TOKEN   — Generate in Events Manager → 설정 → 변환 API
 *   META_CAPI_TEST_CODE      — (optional) Test Events code for verification
 *
 * Endpoint contract:
 *   POST /api/meta-capi
 *   Body: {
 *     event_name: 'PageView' | 'ViewContent' | 'Subscribe' | 'Lead' | ...
 *     event_id:   '<uuid>'   // MUST match Pixel's eventID for deduplication
 *     event_source_url: 'https://www.pap-magazine.com/...'
 *     user_data: {
 *       fbp?: string,       // _fbp cookie (browser ID)
 *       fbc?: string,       // _fbc cookie (click ID)
 *       em?: string,        // email (will be SHA256 hashed)
 *       ph?: string,        // phone (will be SHA256 hashed)
 *       external_id?: string // user account ID (will be SHA256 hashed)
 *     },
 *     custom_data?: { ... } // event-specific data
 *   }
 */

const crypto = require('crypto');
const { handleCors } = require('./_lib/cors');
const { rateLimit, RATE_LIMITS } = require('./_lib/rateLimit');

const META_API_VERSION = 'v21.0';

/* SHA256 hash for PII fields (Meta requirement: lowercase + trim + hash) */
function sha256(value) {
  if (!value || typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/* Extract client IP from Vercel headers (handles x-forwarded-for chain) */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || undefined;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  /* Rate limit: prevent abuse / event flooding from a single IP */
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
  const TEST_CODE = process.env.META_CAPI_TEST_CODE; /* optional */

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    /* Server misconfigured — fail silently to the client (don't break UX),
       but log for ops. Pixel side will still fire, so coverage degrades
       gracefully to "Pixel only". */
    console.error('[meta-capi] Missing META_PIXEL_ID or META_CAPI_ACCESS_TOKEN');
    return res.status(204).end();
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const {
    event_name,
    event_id,
    event_source_url,
    user_data = {},
    custom_data = {},
  } = body;

  if (!event_name || typeof event_name !== 'string') {
    return res.status(400).json({ error: 'event_name is required' });
  }

  /* Build the user_data object that Meta expects.
     - PII fields (em, ph, external_id) MUST be SHA256 hashed
     - fbp/fbc cookies are sent raw (Meta browser identifiers, not PII)
     - IP + UA are sent raw (Meta hashes them server-side) */
  const userData = {
    client_ip_address: getClientIp(req),
    client_user_agent: req.headers['user-agent'],
  };
  if (user_data.fbp) userData.fbp = String(user_data.fbp);
  if (user_data.fbc) userData.fbc = String(user_data.fbc);
  if (user_data.em) userData.em = [sha256(user_data.em)].filter(Boolean);
  if (user_data.ph) userData.ph = [sha256(user_data.ph)].filter(Boolean);
  if (user_data.external_id) userData.external_id = [sha256(user_data.external_id)].filter(Boolean);

  /* event_id is the dedup key — frontend sends the same ID to both Pixel
     and CAPI, Meta merges them into one logical event. If frontend didn't
     supply one, generate so the request still validates (but dedup won't
     work — log a warning). */
  let eventId = event_id;
  if (!eventId) {
    eventId = crypto.randomUUID();
    console.warn('[meta-capi] event_id missing; generated', eventId);
  }

  const payload = {
    data: [
      {
        event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: event_source_url || req.headers.referer || 'https://www.pap-magazine.com',
        user_data: userData,
        custom_data: custom_data,
      },
    ],
  };

  /* Test Events: when set, Meta routes the event to the Test Events tab in
     Events Manager instead of the live data stream. Useful for verifying
     setup without polluting production audiences. Remove the env var to go
     live. */
  if (TEST_CODE) payload.test_event_code = TEST_CODE;

  const url = `https://graph.facebook.com/${META_API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

  try {
    const metaRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const metaText = await metaRes.text();
    let metaJson;
    try { metaJson = JSON.parse(metaText); } catch { metaJson = { raw: metaText }; }

    if (!metaRes.ok) {
      console.error('[meta-capi] Meta API error', metaRes.status, metaJson);
      /* Return 200 to client anyway — ad tracking failures should never
         surface as user-facing errors. Logging is enough for ops. */
      return res.status(200).json({ ok: false, status: metaRes.status });
    }

    return res.status(200).json({
      ok: true,
      events_received: metaJson.events_received,
      fbtrace_id: metaJson.fbtrace_id,
    });
  } catch (err) {
    console.error('[meta-capi] Network error', err.message);
    return res.status(200).json({ ok: false, error: 'network' });
  }
};
