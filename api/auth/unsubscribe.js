/**
 * GET /api/auth/unsubscribe?token=<uuid>
 *
 * One-click email unsubscribe. Looks up the token, flips the owning
 * user's email_consent to false, appends to consent_history, marks
 * the token as used, and returns a self-contained HTML confirmation
 * page (no JS, no login required — works from any inbox client).
 *
 * Why HTML response: this URL is opened directly from the email
 * client, so the user needs to see a clear "you have been unsubscribed"
 * page right away. JSON would just look like a broken page to them.
 *
 * Idempotency: re-using the same token returns the same confirmation
 * page (with a slightly different message). We do NOT 404 — that would
 * be confusing for users who clicked the link twice.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');

const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

function page({ title, body, link }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${title} · PAP Magazine</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    body{margin:0;background:#000;color:#fff;font-family:'Montserrat',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:40px 20px;box-sizing:border-box}
    .card{max-width:480px;width:100%;text-align:center;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);padding:48px 36px}
    .brand{font-size:22px;font-weight:900;letter-spacing:.6em;margin-bottom:32px;padding-left:.6em}
    h1{font-size:18px;font-weight:700;letter-spacing:.04em;margin:0 0 14px}
    p{font-size:13px;line-height:1.8;color:rgba(255,255,255,.55);margin:0 0 24px}
    .cta{display:inline-block;padding:14px 36px;font-size:11px;font-weight:700;letter-spacing:.2em;background:#fff;color:#000;text-decoration:none;text-transform:uppercase}
    .cta.ghost{background:transparent;border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.85)}
    .meta{font-size:10px;color:rgba(255,255,255,.25);margin-top:32px;line-height:1.7;letter-spacing:.04em}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">PAP</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <a href="${link.href}" class="cta ${link.ghost ? 'ghost' : ''}">${link.label}</a>
    <div class="meta">
      마음이 바뀌시면 마이페이지 → 알림 설정에서<br>언제든 다시 구독하실 수 있어요.
    </div>
  </div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const token = (req.query && req.query.token) || '';
  if (!token || typeof token !== 'string') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(page({
      title: '유효하지 않은 링크입니다',
      body: '수신 거부 토큰이 누락되었거나 잘못된 형식입니다. 메일에서 다시 클릭해주세요.',
      link: { href: FRONTEND_URL, label: 'PAP 홈으로', ghost: true },
    }));
  }

  try {
    // 1) Look up the token (service-role bypasses RLS)
    const { data: tokRow, error: tokErr } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token, user_id, campaign_id, used_at')
      .eq('token', token)
      .maybeSingle();

    if (tokErr) throw tokErr;
    if (!tokRow) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(page({
        title: '링크가 만료되었습니다',
        body: '이 수신 거부 링크를 찾을 수 없습니다. 마이페이지에서 직접 알림 설정을 변경하실 수 있어요.',
        link: { href: `${FRONTEND_URL}/mypage#mp-preferences`, label: '마이페이지로 이동' },
      }));
    }

    // 2) Idempotent — if already used, just show confirmation again.
    if (tokRow.used_at) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(page({
        title: '이미 수신 거부 처리되었습니다',
        body: '이 메일에 대한 수신 거부가 이미 적용되어 있어요. 추가로 받으실 일은 없습니다.',
        link: { href: `${FRONTEND_URL}/mypage#mp-preferences`, label: '알림 설정 확인', ghost: true },
      }));
    }

    // 3) Flip email_consent off + capture timestamp
    const nowIso = new Date().toISOString();
    const ipAddr = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
      .split(',')[0].trim() || null;
    const userAgent = (req.headers['user-agent'] || '').slice(0, 500) || null;

    const { error: profErr } = await supabaseAdmin
      .from('profiles')
      .update({ email_consent: false, email_consent_at: null })
      .eq('id', tokRow.user_id);
    if (profErr) throw profErr;

    // 4) Audit trail (best-effort)
    supabaseAdmin.from('consent_history').insert({
      user_id: tokRow.user_id,
      consent_type: 'email',
      granted: false,
      source: 'unsubscribe-link',
      ip_address: ipAddr,
      user_agent: userAgent,
    }).then(({ error }) => { if (error) console.error('[unsubscribe] history insert:', error.message); })
      .catch(err => console.error('[unsubscribe] history threw:', err.message || err));

    // 5) Mark token used so the link can't be replayed
    await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .update({ used_at: nowIso })
      .eq('token', token);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(page({
      title: '수신 거부가 완료되었습니다',
      body: 'PAP Magazine 마케팅 이메일 수신이 즉시 중지되었습니다. 거래성 알림(가입 환영, 비밀번호 재설정 등)은 정상 발송됩니다.',
      link: { href: FRONTEND_URL, label: 'PAP 홈으로' },
    }));
  } catch (err) {
    console.error('[unsubscribe] error:', err.message || err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(page({
      title: '처리 중 오류가 발생했습니다',
      body: '잠시 후 다시 시도해주시거나, 마이페이지에서 직접 알림 설정을 변경해주세요.',
      link: { href: `${FRONTEND_URL}/mypage#mp-preferences`, label: '마이페이지로 이동' },
    }));
  }
};
