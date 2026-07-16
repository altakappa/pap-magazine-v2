/**
 * POST /api/auth/verify-code
 * Verify a 6-digit code against the signed verification token
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { handleCors } = require('../_lib/cors');
const { rateLimitStrict, rateLimitAccount } = require('../_lib/rateLimit');

const JWT_SECRET = process.env.JWT_SECRET;

// Brute-force protection: track failed attempts per IP+email
const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of failedAttempts) {
    if (now > val.resetTime) failedAttempts.delete(key);
  }
}, 60 * 1000);

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Strict rate limiting for code verification (5 req/min)
  if (await rateLimitStrict(req, res, { limit: 5, windowMs: 60 * 1000 }, 'verify-code')) return;

  try {
    const { code, verificationToken } = req.body;

    if (!code || !verificationToken) {
      return res.status(400).json({ message: 'Code and verification token are required' });
    }

    // Verify and decode the token
    let decoded;
    try {
      decoded = jwt.verify(verificationToken, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(410).json({ message: 'Verification code has expired. Please request a new one.' });
      }
      return res.status(400).json({ message: 'Invalid verification token.' });
    }

    // 보안 감사 ③ — 계정 단위 DB 레이트리밋(코드 추측 방어). 아래 인메모리
    // failedAttempts 는 콜드스타트/멀티인스턴스에서 리셋되므로, 계정(이메일)
    // 기준 영속 카운터(8회/15분)를 병행해 IP 로테이션 OTP 브루트포스를 막는다.
    if (await rateLimitAccount(res, decoded.email, { limit: 8, windowMs: 15 * 60 * 1000, name: 'verifycode:acct' })) return;

    // Brute-force check: lock out after MAX_ATTEMPTS failed tries
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const attemptKey = `${ip}:${decoded.email}`;
    const record = failedAttempts.get(attemptKey);
    if (record && record.count >= MAX_ATTEMPTS && Date.now() < record.resetTime) {
      return res.status(429).json({ message: 'Too many failed attempts. Please try again later.' });
    }

    // Compare the code hash
    const inputHash = hashCode(code.toString().trim());
    if (inputHash !== decoded.codeHash) {
      // Track failed attempt
      const existing = failedAttempts.get(attemptKey) || { count: 0, resetTime: Date.now() + LOCKOUT_MS };
      existing.count++;
      existing.resetTime = Date.now() + LOCKOUT_MS;
      failedAttempts.set(attemptKey, existing);
      return res.status(401).json({ message: 'Incorrect verification code.' });
    }

    // Success — clear failed attempts
    failedAttempts.delete(attemptKey);

    // Code is correct — return a verified token for signup
    const verifiedToken = jwt.sign(
      { email: decoded.email, verified: true },
      JWT_SECRET,
      { expiresIn: '30m', algorithm: 'HS256' }
    );

    return res.status(200).json({
      verified: true,
      email: decoded.email,
      verifiedToken,
    });
  } catch (error) {
    console.error('Verify code error:', error.message || error);
    return res.status(500).json({ message: 'Verification failed.' });
  }
};
