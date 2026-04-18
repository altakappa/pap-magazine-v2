/**
 * POST /api/auth/send-code
 * Send a 6-digit verification code to the given email
 * Returns a signed token containing the hashed code + email + expiry
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { handleCors } = require('../_lib/cors');
const { sendEmail } = require('../_lib/email');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { isValidEmail } = require('../_lib/validate');

const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
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

  if (rateLimit(req, res, RATE_LIMITS.auth)) return;

  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    const code = generateCode();
    const codeHash = hashCode(code);

    // Create a signed token with hashed code + email + expiry
    const verificationToken = jwt.sign(
      { email: email.trim().toLowerCase(), codeHash },
      JWT_SECRET,
      { expiresIn: '10m' }
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
