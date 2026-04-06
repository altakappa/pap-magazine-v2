/**
 * PAP Magazine - Rate Limiting
 * In-memory rate limiter for Vercel serverless functions
 *
 * Note: In-memory storage resets on cold starts.
 * For persistent rate limiting, use Upstash Redis (upgrade path).
 */

// In-memory store: { key: { count, resetTime } }
const store = new Map();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store) {
    if (now > val.resetTime) store.delete(key);
  }
}, 60 * 1000);

/**
 * Rate limit check
 * @param {string} key - Unique key (IP or user ID)
 * @param {number} limit - Max requests per window
 * @param {number} windowMs - Time window in ms (default: 60s)
 * @returns {{ allowed: boolean, remaining: number, resetTime: number }}
 */
function checkRateLimit(key, limit = 30, windowMs = 60 * 1000) {
  const now = Date.now();
  const record = store.get(key);

  if (!record || now > record.resetTime) {
    store.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetTime: now + windowMs };
  }

  record.count++;
  if (record.count > limit) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime };
  }

  return { allowed: true, remaining: limit - record.count, resetTime: record.resetTime };
}

/**
 * Apply rate limiting to a request
 * Returns true if rate limited (response already sent)
 */
function rateLimit(req, res, { limit = 30, windowMs = 60000 } = {}) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';

  const result = checkRateLimit(ip, limit, windowMs);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

  if (!result.allowed) {
    res.status(429).json({
      message: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
    });
    return true;
  }

  return false;
}

// Preset configs for different endpoint types
const RATE_LIMITS = {
  auth: { limit: 10, windowMs: 60 * 1000 },      // 10 req/min for login/signup
  api: { limit: 60, windowMs: 60 * 1000 },        // 60 req/min general
  upload: { limit: 5, windowMs: 60 * 1000 },       // 5 uploads/min
  webhook: { limit: 100, windowMs: 60 * 1000 },    // 100 req/min for webhooks
};

module.exports = { rateLimit, checkRateLimit, RATE_LIMITS };
