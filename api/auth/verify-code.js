/**
 * POST /api/auth/verify-code
 * Verify a 6-digit code against the signed verification token
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { handleCors } = require('../_lib/cors');

const JWT_SECRET = process.env.JWT_SECRET;

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { code, verificationToken } = req.body;

    if (!code || !verificationToken) {
      return res.status(400).json({ message: 'Code and verification token are required' });
    }

    // Verify and decode the token
    let decoded;
    try {
      decoded = jwt.verify(verificationToken, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(410).json({ message: 'Verification code has expired. Please request a new one.' });
      }
      return res.status(400).json({ message: 'Invalid verification token.' });
    }

    // Compare the code hash
    const inputHash = hashCode(code.toString().trim());
    if (inputHash !== decoded.codeHash) {
      return res.status(401).json({ message: 'Incorrect verification code.' });
    }

    // Code is correct — return a verified token for signup
    const verifiedToken = jwt.sign(
      { email: decoded.email, verified: true },
      JWT_SECRET,
      { expiresIn: '30m' }
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
