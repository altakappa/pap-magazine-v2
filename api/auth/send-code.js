/**
 * POST /api/auth/send-code
 * Send a 6-digit verification code to the given email
 * Returns a signed token containing the hashed code + email + expiry
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { handleCors } = require('../_lib/cors');
const { sendEmail } = require('../_lib/email');
const { rateLimitStrict, rateLimitAccount, RATE_LIMITS } = require('../_lib/rateLimit');
const { isValidEmail } = require('../_lib/validate');

const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

/* 2026-09-04 보안감사 — 예전에는 sha256(code) 를 verificationToken(JWT) 에 넣어
   클라이언트로 돌려줬다. JWT 는 서명만 되고 암호화는 안 되므로 누구나 payload 를 읽는다.
   6자리 코드는 90만 가지뿐이라 해시를 받은 사람은 1초 안에 코드를 역산할 수 있었다.
   → 이메일 인증을 통째로 우회해 아무 이메일로나 가입 가능(오프라인 브루트포스).
   지금은 서버 비밀키(JWT_SECRET)로 HMAC 을 만든다. 비밀키 없이는 클라이언트가 같은 값을
   계산할 수 없으므로 payload 를 읽어도 코드를 알 수 없다. 이메일을 함께 섞어 토큰 재사용도 막는다.
   send-code.js 와 verify-code.js 는 **반드시 같은 함수**여야 한다. */
function hashCode(code, email) {
  return crypto.createHmac('sha256', JWT_SECRET)
    .update(String(email || '').trim().toLowerCase() + ':' + String(code))
    .digest('hex');
}

function buildVerificationEmail(code) {
  return {
    subject: 'PAP Magazine - 이메일 인증 코드 / Verification Code',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;">
  <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #222;">
    <a href="${FRONTEND_URL}" style="color:#fff;font-size:28px;font-weight:700;letter-spacing:8px;text-decoration:none;">PAP</a>
  </td></tr>
  <tr><td style="padding:32px 40px;color:#ccc;font-size:14px;line-height:1.7;">
    <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">이메일 인증 / Email Verification</h2>
    <p>아래 인증 코드를 입력해주세요.<br>Please enter the verification code below.</p>
    <div style="margin:24px 0;padding:20px;background:#000;border:1px solid #333;text-align:center;">
      <span style="color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;font-family:monospace;">${code}</span>
    </div>
    <p style="color:#888;font-size:12px;">이 코드는 10분간 유효합니다. 본인이 요청하지 않았다면 이 이메일을 무시해주세요.<br>
    This code expires in 10 minutes. If you didn't request this, please ignore this email.</p>
  </td></tr>
  <tr><td style="padding:24px 40px;border-top:1px solid #222;color:#666;font-size:11px;">
    &copy; ${new Date().getFullYear()} PAP Magazine. All rights reserved.
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (await rateLimitStrict(req, res, RATE_LIMITS.auth, 'send-code')) return;

  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    // 보안 감사 ③ — 계정 단위 레이트리밋(이메일 폭탄 방지). 한 주소로 코드가
    // 무한 발송되지 않도록 계정(이메일)당 5회/15분으로 제한(IP 리밋과 병행).
    if (await rateLimitAccount(res, email, { limit: 5, windowMs: 15 * 60 * 1000, name: 'sendcode:acct' })) return;

    const code = generateCode();
    const codeHash = hashCode(code, email);

    // Create a signed token with hashed code + email + expiry
    const verificationToken = jwt.sign(
      { email: email.trim().toLowerCase(), codeHash },
      JWT_SECRET,
      { expiresIn: '10m', algorithm: 'HS256' }
    );

    // Send the code via email
    const result = await sendEmail(email.trim(), buildVerificationEmail(code));

    if (result.skipped) {
      // SMTP not configured — log warning but do NOT expose code in response
      console.warn('[VERIFY] SMTP not configured. Email was not sent.');
      return res.status(200).json({
        verificationToken,
        message: 'Verification code sent',
      });
    }

    if (!result.sent) {
      return res.status(500).json({ message: 'Failed to send verification email. Please try again.' });
    }

    return res.status(200).json({
      verificationToken,
      message: 'Verification code sent',
    });
  } catch (error) {
    console.error('Send code error:', error.message || error);
    return res.status(500).json({ message: 'Failed to send verification code.' });
  }
};
