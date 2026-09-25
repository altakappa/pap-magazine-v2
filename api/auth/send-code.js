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

/* 2026-09-25 — 받는 사람 언어 하나로 (도메니코 "각자의 언어로 전달되야 하는건 알고있찌?").
 * 전에는 한국어·영어를 한 메일에 같이 적었다. 가입 화면이 보낸 lang(화면 언어)으로 한 언어만.
 * lang 이 없으면(옛 화면 캐시) Accept-Language 첫 언어, 그것도 모르면 영어. */
const CODE_COPY = {
  ko: { subject: 'PAP 매거진 인증 코드', heading: '이메일 인증', body: '아래 인증 코드를 입력해 주세요.', expiry: '이 코드는 10분간 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.', rights: '모든 권리 보유.' },
  en: { subject: 'PAP Magazine verification code', heading: 'Email verification', body: 'Please enter the verification code below.', expiry: 'This code expires in 10 minutes. If you didn’t request it, please ignore this email.', rights: 'All rights reserved.' },
  it: { subject: 'Codice di verifica PAP Magazine', heading: 'Verifica email', body: 'Inserisci il codice di verifica qui sotto.', expiry: 'Il codice scade tra 10 minuti. Se non lo hai richiesto, ignora questa email.', rights: 'Tutti i diritti riservati.' },
  fr: { subject: 'Code de vérification PAP Magazine', heading: 'Vérification de l’e-mail', body: 'Saisissez le code de vérification ci-dessous.', expiry: 'Ce code expire dans 10 minutes. Si vous ne l’avez pas demandé, ignorez cet e-mail.', rights: 'Tous droits réservés.' },
  es: { subject: 'Código de verificación de PAP Magazine', heading: 'Verificación de correo', body: 'Introduce el código de verificación que aparece abajo.', expiry: 'Este código caduca en 10 minutos. Si no lo has solicitado, ignora este correo.', rights: 'Todos los derechos reservados.' },
  ja: { subject: 'PAPマガジン 認証コード', heading: 'メール認証', body: '以下の認証コードを入力してください。', expiry: 'このコードの有効期限は10分です。お心当たりがない場合は、このメールを破棄してください。', rights: '無断転載を禁じます。' },
  zh: { subject: 'PAP 杂志验证码', heading: '邮箱验证', body: '请输入以下验证码。', expiry: '验证码 10 分钟内有效。如非本人操作,请忽略此邮件。', rights: '版权所有。' },
  ru: { subject: 'Код подтверждения PAP Magazine', heading: 'Подтверждение почты', body: 'Введите код подтверждения ниже.', expiry: 'Код действителен 10 минут. Если вы его не запрашивали, просто проигнорируйте это письмо.', rights: 'Все права защищены.' },
  de: { subject: 'PAP Magazine Bestätigungscode', heading: 'E-Mail-Bestätigung', body: 'Bitte gib den folgenden Bestätigungscode ein.', expiry: 'Der Code ist 10 Minuten gültig. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail.', rights: 'Alle Rechte vorbehalten.' },
};

function pickCodeLang(bodyLang, acceptLanguage) {
  const norm = (v) => String(v || '').trim().toLowerCase().slice(0, 2);
  const a = norm(bodyLang);
  if (CODE_COPY[a]) return a;
  const first = String(acceptLanguage || '').split(',').map((x) => norm(x)).find((x) => CODE_COPY[x]);
  return first || 'en';
}

function buildVerificationEmail(code, lang) {
  const C = CODE_COPY[lang] || CODE_COPY.en;
  const safeCode = String(code).replace(/[^0-9A-Za-z]/g, '');
  return {
    subject: C.subject,
    html: `<!DOCTYPE html>
<html lang="${lang in CODE_COPY ? lang : 'en'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;">
  <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #222;">
    <a href="${FRONTEND_URL}" style="color:#fff;font-size:28px;font-weight:700;letter-spacing:8px;text-decoration:none;">PAP</a>
  </td></tr>
  <tr><td style="padding:32px 40px;color:#ccc;font-size:14px;line-height:1.7;">
    <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${C.heading}</h2>
    <p>${C.body}</p>
    <div style="margin:24px 0;padding:20px;background:#000;border:1px solid #333;text-align:center;">
      <span style="color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;font-family:monospace;">${safeCode}</span>
    </div>
    <p style="color:#888;font-size:12px;">${C.expiry}</p>
  </td></tr>
  <tr><td style="padding:24px 40px;border-top:1px solid #222;color:#666;font-size:11px;">
    &copy; ${new Date().getFullYear()} PAP Magazine. ${C.rights}
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
    const codeLang = pickCodeLang(req.body && req.body.lang, req.headers && req.headers['accept-language']);

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
    const result = await sendEmail(email.trim(), buildVerificationEmail(code, codeLang), { transactional: true });

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

// 테스트용 (tests/email-one-language.test.js)
module.exports.buildVerificationEmail = buildVerificationEmail;
module.exports.pickCodeLang = pickCodeLang;
module.exports.CODE_COPY = CODE_COPY;
