/**
 * POST /api/auth/reset-password — 6자리 코드로 비밀번호 재설정 (2026-10-13)
 *
 * 흐름: send-code(purpose:'reset') → verify-code → 여기(verifiedToken + 새 비밀번호).
 * 왜 링크가 아니라 코드인가: 핫메일/아웃룩 보안 스캐너가 1회용 재설정 링크를 사람보다 먼저 열어
 * 사용자가 누르면 "만료"가 된다(10/13 Iván 사례). 코드는 로봇이 열어도 아무 일이 없다.
 *
 * 안전핀: verifiedToken 은 purpose:'reset' 이어야 한다(가입 코드로는 못 바꾼다). 바꾼 뒤
 * token_version 을 올려 기존 로그인 전부 무효화. 계정 유무는 응답으로 노출하지 않는다.
 */
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimitStrict, RATE_LIMITS } = require('../_lib/rateLimit');

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (await rateLimitStrict(req, res, RATE_LIMITS.auth, 'reset-password')) return;

  try {
    const { verifiedToken, password } = req.body || {};
    if (!verifiedToken || !password) return res.status(400).json({ message: 'Verification and new password are required' });

    let decoded;
    try {
      decoded = jwt.verify(verifiedToken, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      return res.status(400).json({ message: 'Verification expired. Please request a new code.' });
    }
    if (!decoded.verified || decoded.purpose !== 'reset' || !decoded.email) {
      return res.status(400).json({ message: 'Verification mismatch' });
    }

    // 가입과 같은 정책(서버): 8자 이상, 글자+숫자. 화면은 대문자까지 요구한다.
    if (String(password).length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ message: 'Password must contain at least one letter and one number' });
    }

    const { data: prof } = await supabaseAdmin.from('profiles')
      .select('id, token_version').ilike('email', decoded.email).maybeSingle();
    if (!prof) {
      // 계정이 없어도 같은 모양으로 답한다(열거 방지). 코드 메일도 애초에 안 갔다.
      return res.status(200).json({ ok: true });
    }

    const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(prof.id, { password: String(password) });
    if (upErr) {
      console.error('[reset-password] updateUserById 실패:', upErr.message);
      if (/weak|easy to guess|pwned|leaked/i.test(upErr.message || '')) {
        return res.status(400).json({ code: 'weak_password', message: "This password appears on public lists from other websites' data breaches, so it is not safe to use. Please choose a different password." });
      }
      return res.status(500).json({ message: 'Could not update password. Please try again.' });
    }
    // 기존 로그인 전부 무효화
    await supabaseAdmin.from('profiles')
      .update({ token_version: (Number(prof.token_version) || 0) + 1 })
      .eq('id', prof.id);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[reset-password] 예외:', e.message || e);
    return res.status(500).json({ message: 'Could not update password. Please try again.' });
  }
};
