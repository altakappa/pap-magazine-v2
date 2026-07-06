/**
 * GET /api/email/language?token=<uuid>&lang=<ko|en|it|fr|es|ja|zh|ru|de>
 *
 * One-click newsletter-language switch, linked from the language
 * selector row inside every weekly email. Authenticates the same way
 * the unsubscribe link does: via the per-recipient token minted at
 * send time (email_unsubscribe_tokens). Unlike unsubscribe, the token
 * is NOT consumed — the member can click several languages until one
 * feels right, and the unsubscribe link in the same email keeps
 * working.
 *
 * Effect: profiles.email_language = lang (the top of the locale
 * resolution chain in _lib/emailLocale.js), so the very next campaign
 * renders in the chosen language.
 *
 * Response is a self-contained HTML confirmation page localized in
 * the newly chosen language — no login, no JS required.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { SUPPORTED_LANGS, LANG_LABELS } = require('../_lib/emailLocale');

const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

// Confirmation copy per locale. Keys mirror SUPPORTED_LANGS; anything
// missing falls back to English (should never happen — belt+suspenders).
const I18N = {
  ko: { title: '이메일 언어가 변경되었습니다', body: '앞으로 PAP 뉴스레터를 {label}(으)로 보내드립니다. 다음 발송분부터 적용됩니다.', cta: 'PAP 홈으로', invalid: '유효하지 않은 링크입니다', invalidBody: '링크가 만료되었거나 잘못되었습니다. 마이페이지 → 알림 설정에서 직접 변경하실 수 있어요.', mypage: '마이페이지로 이동' },
  en: { title: 'Email language updated', body: 'Your PAP newsletters will now arrive in {label}. The change applies from the next send.', cta: 'Back to PAP', invalid: 'Invalid link', invalidBody: 'This link is expired or malformed. You can change your preference anytime in My Page → Notification settings.', mypage: 'Go to My Page' },
  it: { title: 'Lingua email aggiornata', body: 'Le newsletter di PAP arriveranno ora in {label}. La modifica vale dal prossimo invio.', cta: 'Torna a PAP', invalid: 'Link non valido', invalidBody: 'Questo link è scaduto o non valido. Puoi cambiare la preferenza in My Page → impostazioni notifiche.', mypage: 'Vai a My Page' },
  fr: { title: 'Langue des emails mise à jour', body: 'Vos newsletters PAP arriveront désormais en {label}. Le changement s’applique dès le prochain envoi.', cta: 'Retour à PAP', invalid: 'Lien invalide', invalidBody: 'Ce lien est expiré ou incorrect. Vous pouvez modifier votre préférence dans My Page → paramètres de notification.', mypage: 'Aller à My Page' },
  es: { title: 'Idioma de email actualizado', body: 'Tus newsletters de PAP llegarán ahora en {label}. El cambio se aplica desde el próximo envío.', cta: 'Volver a PAP', invalid: 'Enlace no válido', invalidBody: 'Este enlace ha caducado o es incorrecto. Puedes cambiar tu preferencia en My Page → ajustes de notificaciones.', mypage: 'Ir a My Page' },
  ja: { title: 'メール言語を変更しました', body: '今後、PAPニュースレターは{label}でお届けします。次回配信分から適用されます。', cta: 'PAPホームへ', invalid: '無効なリンクです', invalidBody: 'リンクが期限切れか不正です。マイページ→通知設定からも変更できます。', mypage: 'マイページへ' },
  zh: { title: '邮件语言已更新', body: '今后 PAP 新闻邮件将以{label}发送，自下一期起生效。', cta: '返回 PAP', invalid: '链接无效', invalidBody: '此链接已过期或有误。您可以在 My Page → 通知设置中直接修改。', mypage: '前往 My Page' },
  ru: { title: 'Язык рассылки обновлён', body: 'Рассылки PAP теперь будут приходить на {label}. Изменение вступит в силу со следующего выпуска.', cta: 'На главную PAP', invalid: 'Недействительная ссылка', invalidBody: 'Ссылка устарела или неверна. Изменить настройку можно в My Page → настройки уведомлений.', mypage: 'В My Page' },
  de: { title: 'E-Mail-Sprache aktualisiert', body: 'Deine PAP-Newsletter kommen ab jetzt auf {label}. Die Änderung gilt ab dem nächsten Versand.', cta: 'Zurück zu PAP', invalid: 'Ungültiger Link', invalidBody: 'Dieser Link ist abgelaufen oder fehlerhaft. Du kannst die Einstellung jederzeit unter My Page → Benachrichtigungen ändern.', mypage: 'Zu My Page' },
};

function page(lang, { title, body, link }) {
  return `<!DOCTYPE html>
<html lang="${lang}">
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
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">PAP</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <a href="${link.href}" class="cta">${link.label}</a>
  </div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const token = (req.query && req.query.token) || '';
  const wanted = (req.query && req.query.lang) || '';
  const lang = SUPPORTED_LANGS.includes(wanted) ? wanted : null;
  const L = I18N[lang] || I18N.en;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!token || typeof token !== 'string' || !lang) {
    return res.status(400).send(page(lang || 'en', {
      title: L.invalid,
      body: L.invalidBody,
      link: { href: `${FRONTEND_URL}/mypage#mp-preferences`, label: L.mypage },
    }));
  }

  try {
    // Token authenticates the member; NOT consumed (unsubscribe stays valid).
    const { data: tokRow, error: tokErr } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token, user_id')
      .eq('token', token)
      .maybeSingle();
    if (tokErr) throw tokErr;

    if (!tokRow) {
      return res.status(404).send(page(lang, {
        title: L.invalid,
        body: L.invalidBody,
        link: { href: `${FRONTEND_URL}/mypage#mp-preferences`, label: L.mypage },
      }));
    }

    const { error: profErr } = await supabaseAdmin
      .from('profiles')
      .update({ email_language: lang })
      .eq('id', tokRow.user_id);
    if (profErr) throw profErr;

    return res.status(200).send(page(lang, {
      title: L.title,
      body: L.body.replace('{label}', `<strong style="color:#fff;">${LANG_LABELS[lang]}</strong>`),
      link: { href: FRONTEND_URL, label: L.cta },
    }));
  } catch (err) {
    console.error('[email/language] error:', err.message || err);
    return res.status(500).send(page(lang, {
      title: L.invalid,
      body: L.invalidBody,
      link: { href: `${FRONTEND_URL}/mypage#mp-preferences`, label: L.mypage },
    }));
  }
};
