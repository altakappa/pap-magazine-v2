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

// Preset configs for different endpoint types.
// `upload` was 5/min, which broke the actual editorial workflow — a single
// post legitimately holds 10–30 look images, and the admin uploads them
// one-at-a-time (one HTTP request per image). 5/min meant the 6th image
// onward got 429'd. Bumped to 120/min so a full 30-image post can finish
// in a single batch and a few retries still have headroom; abuse from a
// non-admin caller is already blocked one layer up by requireAdmin.
const RATE_LIMITS = {
  auth: { limit: 10, windowMs: 60 * 1000 },      // 10 req/min for login/signup
  api: { limit: 60, windowMs: 60 * 1000 },        // 60 req/min general
  upload: { limit: 120, windowMs: 60 * 1000 },     // 120 uploads/min — admin batches
  webhook: { limit: 100, windowMs: 60 * 1000 },    // 100 req/min for webhooks
};

/**
 * 보안 강화 (2026-07) — DB 기반 영속 레이트리밋.
 *
 * 인메모리 rateLimit() 은 콜드스타트/멀티 인스턴스에서 리셋되어
 * 로그인 브루트포스를 실질적으로 못 막는다. 인증 엔드포인트
 * (login/signup/send-code/verify-code)만 이 함수를 쓴다 — Supabase
 * rl_hit() RPC(060_rate_limits.sql)로 원자적 카운트.
 *
 * fail-open: DB 오류 시 인메모리 검사로 폴백 (가용성 우선 — 로그인
 * 자체가 막히는 사고 방지). 사용법:
 *   if (await rateLimitStrict(req, res, RATE_LIMITS.auth, 'login')) return;
 */
async function rateLimitStrict(req, res, { limit = 10, windowMs = 60000 } = {}, name = 'auth') {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  const key = name + ':' + ip;

  try {
    const { supabaseAdmin } = require('./supabase');
    const { data, error } = await supabaseAdmin.rpc('rl_hit', {
      p_key: key, p_limit: limit, p_window_ms: windowMs,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const resetSec = Math.ceil(new Date(row.reset_at).getTime() / 1000);
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', row.remaining);
    res.setHeader('X-RateLimit-Reset', resetSec);

    if (!row.allowed) {
      res.status(429).json({
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.max(resetSec - Math.ceil(Date.now() / 1000), 1),
      });
      return true;
    }
    return false;
  } catch (err) {
    // RPC 미배포/일시 장애 — 인메모리 폴백 (없는 것보단 낫다)
    console.error('[rateLimitStrict] DB fallback:', err.message || err);
    return rateLimit(req, res, { limit, windowMs });
  }
}

module.exports = { rateLimit, rateLimitStrict, checkRateLimit, RATE_LIMITS };
