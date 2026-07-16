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

/**
 * 계정(이메일 등 식별자) 단위 레이트리밋 — 보안 감사 ③(2026-07).
 *
 * 기존 rateLimit/rateLimitStrict 는 키가 IP 라서, 공격자가 IP 를 바꿔가며
 * 특정 계정을 노리는 분산 브루트포스를 못 막았다. 이 함수는 IP 가 아니라
 * "계정 식별자"(주로 이메일) 기준으로 rl_hit 카운트 → 같은 계정을 여러 IP 로
 * 노려도 계정별 총 시도가 제한된다. IP 리밋과 **병행**(IP=1차, 계정=2차).
 *
 * - 식별자는 sha256 해시로 키에 저장 → rate_limits 테이블에 이메일 평문을
 *   남기지 않는다(PII 최소화).
 * - X-RateLimit 헤더는 세팅하지 않는다(IP 리밋이 이미 세팅했고, 계정 리밋
 *   상태를 응답으로 노출하지 않기 위함).
 * - fail-open: DB 오류 시 통과(가용성 우선 — IP 리밋이 1차 방어로 남아있음).
 *
 * 사용:
 *   if (await rateLimitAccount(res, email, { limit: 15, windowMs: 15*60*1000, name: 'login:acct' })) return;
 */
async function rateLimitAccount(res, identifier, { limit = 15, windowMs = 15 * 60 * 1000, name = 'acct' } = {}) {
  if (!identifier) return false;
  const crypto = require('crypto');
  const h = crypto.createHash('sha256').update(String(identifier).toLowerCase().trim()).digest('hex').slice(0, 40);
  const key = name + ':' + h;
  try {
    const { supabaseAdmin } = require('./supabase');
    const { data, error } = await supabaseAdmin.rpc('rl_hit', {
      p_key: key, p_limit: limit, p_window_ms: windowMs,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row.allowed) {
      const resetSec = Math.ceil(new Date(row.reset_at).getTime() / 1000);
      res.status(429).json({
        message: 'Too many attempts for this account. Please try again later.',
        retryAfter: Math.max(resetSec - Math.ceil(Date.now() / 1000), 1),
      });
      return true;
    }
    return false;
  } catch (err) {
    console.error('[rateLimitAccount] skip (DB err):', err.message || err);
    return false; // fail-open
  }
}

module.exports = { rateLimit, rateLimitStrict, rateLimitAccount, checkRateLimit, RATE_LIMITS };
