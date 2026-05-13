/**
 * PAP Magazine - Email Service
 * Nodemailer-based transactional email sender
 */

const nodemailer = require('nodemailer');

// Create reusable transporter
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

const FROM = process.env.EMAIL_FROM || 'PAP Magazine <contact@pap-magazine.com>';
const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

// ── Shared HTML wrapper ──
function wrapHtml(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;">
  <!-- Header -->
  <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #222;">
    <a href="${FRONTEND_URL}" style="color:#fff;font-size:28px;font-weight:700;letter-spacing:8px;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">PAP</a>
  </td></tr>
  <!-- Content -->
  <tr><td style="padding:32px 40px;color:#ccc;font-size:14px;line-height:1.7;">
    ${content}
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:24px 40px;border-top:1px solid #222;color:#666;font-size:11px;line-height:1.5;">
    &copy; ${new Date().getFullYear()} PAP Magazine. All rights reserved.<br>
    <a href="${FRONTEND_URL}" style="color:#888;text-decoration:none;">www.pap-magazine.com</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── i18n copy for the unified "submission review complete" email ──
// Strings are intentionally outcome-agnostic — the receiver always sees
// the same message regardless of approved / rejected / revision; the
// real decision lives on the site at /submission.html#mySubsSection.
// Keep the keys identical across locales so submissionReviewComplete()
// can swap dictionaries without per-locale special-casing.
const SUBMISSION_REVIEW_I18N = {
  ko: {
    subject: '심사가 완료되었습니다 — "{title}"',
    heading: '서브미션 심사 완료',
    greet: '{name}님, 안녕하세요.',
    greetingFallback: '회원',
    body1: 'PAP 매거진에 제출하신 {title}의 심사가 완료되었습니다.',
    body2: '결과 및 편집팀의 코멘트는 PAP 플랫폼의 <strong style="color:#fff;">MY SUBMISSIONS</strong>에서 확인하실 수 있습니다.',
    cta: '결과 확인',
    footer: '문의 사항이 있다면 이 메일에 회신해주세요. 편집팀이 도와드립니다.',
  },
  en: {
    subject: 'Your submission review is complete — "{title}"',
    heading: 'Submission Review Complete',
    greet: 'Hi {name},',
    greetingFallback: 'there',
    body1: 'The review of your submission to PAP Magazine, {title}, has been completed.',
    body2: 'Sign in to the PAP platform to read the result and the editorial team’s notes in <strong style="color:#fff;">MY SUBMISSIONS</strong>.',
    cta: 'VIEW RESULT',
    footer: 'Questions? Reply to this email and our editorial team will respond.',
  },
  it: {
    subject: 'La tua revisione è completa — "{title}"',
    heading: 'Revisione completata',
    greet: 'Ciao {name},',
    greetingFallback: 'lettore',
    body1: 'La revisione del tuo invio a PAP Magazine, {title}, è stata completata.',
    body2: 'Accedi alla piattaforma PAP per leggere il risultato e i commenti del team editoriale in <strong style="color:#fff;">MY SUBMISSIONS</strong>.',
    cta: 'VEDI ESITO',
    footer: 'Per qualsiasi domanda, rispondi a questa email — il nostro team editoriale ti risponderà.',
  },
  fr: {
    subject: 'Votre soumission a été examinée — "{title}"',
    heading: 'Examen terminé',
    greet: 'Bonjour {name},',
    greetingFallback: 'lecteur',
    body1: 'L’examen de votre soumission à PAP Magazine, {title}, est terminé.',
    body2: 'Connectez-vous à la plateforme PAP pour consulter le résultat et les notes de l’équipe éditoriale dans <strong style="color:#fff;">MY SUBMISSIONS</strong>.',
    cta: 'VOIR LE RÉSULTAT',
    footer: 'Une question ? Répondez à cet email — notre équipe vous recontactera.',
  },
  es: {
    subject: 'Tu envío ha sido revisado — "{title}"',
    heading: 'Revisión completada',
    greet: 'Hola {name},',
    greetingFallback: 'lector',
    body1: 'La revisión de tu envío a PAP Magazine, {title}, ha sido completada.',
    body2: 'Inicia sesión en la plataforma PAP para ver el resultado y los comentarios del equipo editorial en <strong style="color:#fff;">MY SUBMISSIONS</strong>.',
    cta: 'VER RESULTADO',
    footer: '¿Preguntas? Responde a este email y nuestro equipo editorial te responderá.',
  },
  ja: {
    subject: '審査が完了しました — "{title}"',
    heading: 'サブミッション審査完了',
    greet: '{name} 様',
    greetingFallback: 'クリエイター',
    body1: 'PAP Magazine に提出いただいた {title} の審査が完了しました。',
    body2: '結果と編集部からのコメントは、PAP プラットフォームの <strong style="color:#fff;">MY SUBMISSIONS</strong> でご確認いただけます。',
    cta: '結果を見る',
    footer: 'ご不明な点があれば、このメールにご返信ください。編集部より回答いたします。',
  },
  zh: {
    subject: '您的投稿审核已完成 — "{title}"',
    heading: '投稿审核完成',
    greet: '{name},您好,',
    greetingFallback: '创作者',
    body1: '您提交至 PAP Magazine 的作品 {title} 审核已完成。',
    body2: '请登录 PAP 平台,在 <strong style="color:#fff;">MY SUBMISSIONS</strong> 中查看审核结果与编辑部留言。',
    cta: '查看结果',
    footer: '如有任何疑问,请直接回复本邮件,编辑部将与您联系。',
  },
  ru: {
    subject: 'Рассмотрение вашей заявки завершено — "{title}"',
    heading: 'Рассмотрение завершено',
    greet: 'Здравствуйте, {name}!',
    greetingFallback: 'участник',
    body1: 'Рассмотрение вашей работы {title}, отправленной в PAP Magazine, завершено.',
    body2: 'Войдите в платформу PAP, чтобы увидеть результат и комментарии редакции в разделе <strong style="color:#fff;">MY SUBMISSIONS</strong>.',
    cta: 'СМОТРЕТЬ РЕЗУЛЬТАТ',
    footer: 'Вопросы? Ответьте на это письмо — редакция свяжется с вами.',
  },
  de: {
    subject: 'Die Prüfung deiner Einreichung ist abgeschlossen — "{title}"',
    heading: 'Prüfung abgeschlossen',
    greet: 'Hallo {name},',
    greetingFallback: 'Leser',
    body1: 'Die Prüfung deiner Einreichung an PAP Magazine, {title}, ist abgeschlossen.',
    body2: 'Melde dich auf der PAP-Plattform an, um Ergebnis und Kommentare der Redaktion in <strong style="color:#fff;">MY SUBMISSIONS</strong> einzusehen.',
    cta: 'ERGEBNIS ANSEHEN',
    footer: 'Fragen? Antworte auf diese E-Mail — unsere Redaktion meldet sich.',
  },
};

// ── Email Templates ──

const templates = {
  // 1. Welcome email after signup
  welcome(user) {
    return {
      subject: 'Welcome to PAP Magazine',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Welcome, ${user.name || 'Creative'}.</h2>
        <p>Thank you for joining PAP Magazine — a platform for emerging fashion creatives.</p>
        <p>Here's what you can do now:</p>
        <table cellpadding="0" cellspacing="0" style="margin:20px 0;">
          <tr><td style="padding:8px 0;color:#ccc;">
            <strong style="color:#fff;">Submit Your Work</strong><br>
            <span style="color:#999;font-size:13px;">Share your editorial with our curation team</span>
          </td></tr>
          <tr><td style="padding:8px 0;color:#ccc;">
            <strong style="color:#fff;">Request a Pull-Letter</strong><br>
            <span style="color:#999;font-size:13px;">Borrow garments from designer showrooms</span>
          </td></tr>
          <tr><td style="padding:8px 0;color:#ccc;">
            <strong style="color:#fff;">Join the Community</strong><br>
            <span style="color:#999;font-size:13px;">Connect with photographers, stylists, and models</span>
          </td></tr>
        </table>
        <a href="${FRONTEND_URL}/submission.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">START SUBMITTING</a>
      `),
    };
  },

  // 2. Submission received confirmation
  submissionReceived(user, submission) {
    return {
      subject: `Submission Received: ${submission.title}`,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Submission Received</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>We've received your editorial submission <strong style="color:#fff;">"${submission.title}"</strong>.</p>
        <table style="margin:20px 0;width:100%;">
          <tr>
            <td style="padding:12px 16px;background:#1a1a1a;border-left:3px solid #fff;">
              <span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Status</span><br>
              <span style="color:#fff;font-size:14px;font-weight:600;">Under Review</span>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;background:#1a1a1a;border-left:3px solid #333;">
              <span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Expected Response</span><br>
              <span style="color:#fff;font-size:14px;">1–3 business days</span>
            </td>
          </tr>
        </table>
        <p>Our editorial team will review your work carefully. You'll receive an email once a decision has been made.</p>
        <a href="${FRONTEND_URL}/submission.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">VIEW MY SUBMISSIONS</a>
      `),
    };
  },

  // 3. Submission review complete — single neutral notification (QA #165).
  //
  // Previously three separate templates leaked the decision (approved /
  // rejected / revision) in the subject + body. Marketing rewrote this
  // into ONE outcome-agnostic email that drives the submitter back to
  // MY SUBMISSIONS on the live platform. Two upsides:
  //   1) Every review → a guaranteed site visit (browse-while-checking).
  //   2) Rejection feedback stays inside the platform, not in the user's
  //      inbox where it could be screenshotted out of context.
  //
  // Localised per recipient via profile.email_language (consent.js gives
  // us the value; review.js looks it up and passes `lang` in). Falls
  // back to English for any locale we don't have copy for yet.
  submissionReviewComplete(user, submission, lang) {
    const L = SUBMISSION_REVIEW_I18N[lang] || SUBMISSION_REVIEW_I18N.en;
    const safeName = user && user.name ? user.name : (L.greetingFallback);
    const safeTitle = submission && submission.title ? submission.title : '—';
    const ctaUrl = `${FRONTEND_URL}/submission.html#mySubsSection`;
    return {
      subject: L.subject.replace('{title}', safeTitle),
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${L.heading}</h2>
        <p>${L.greet.replace('{name}', safeName)}</p>
        <p>${L.body1.replace('{title}', `<strong style="color:#fff;">"${safeTitle}"</strong>`)}</p>
        <p>${L.body2}</p>
        <a href="${ctaUrl}" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">${L.cta}</a>
        <p style="font-size:12px;color:#888;margin-top:24px;">${L.footer}</p>
      `),
    };
  },

  // Legacy aliases kept so callers that still hardcode the per-status
  // template names keep working. They all funnel into the single
  // submissionReviewComplete entry point above.
  submissionApproved(user, submission, _note, lang) {
    return templates.submissionReviewComplete(user, submission, lang);
  },
  submissionRejected(user, submission, _note, lang) {
    return templates.submissionReviewComplete(user, submission, lang);
  },
  submissionRevision(user, submission, _note, lang) {
    return templates.submissionReviewComplete(user, submission, lang);
  },


  // 5. Pull-letter request received
  pullletterReceived(user) {
    return {
      subject: 'Pull-Letter Request Received',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Pull-Letter Request Received</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Your pull-letter request has been received. Our team will review the availability of the requested pieces and coordinate with the relevant showrooms.</p>
        <table style="margin:20px 0;width:100%;">
          <tr><td style="padding:12px 16px;background:#1a1a1a;border-left:3px solid #fff;">
            <span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Status</span><br>
            <span style="color:#fff;font-size:14px;font-weight:600;">Processing</span>
          </td></tr>
        </table>
        <p>We'll reach out with next steps once the pull has been confirmed.</p>
      `),
    };
  },

  // 6. Pull-letter accepted
  pullletterAccepted(user, note) {
    return {
      subject: 'Pull-Letter Approved',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Pull-Letter Approved</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Your pull-letter request has been approved. We will coordinate the delivery of the garments with the showroom.</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #4CAF50;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Details</span><br><span style="color:#ccc;font-size:14px;">${note}</span></div>` : ''}
        <a href="${FRONTEND_URL}/pullletter.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">VIEW REQUESTS</a>
      `),
    };
  },

  // 7. Pull-letter rejected
  pullletterRejected(user, note) {
    return {
      subject: 'Pull-Letter Request Update',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Pull-Letter Update</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Unfortunately, we're unable to fulfill your pull-letter request at this time. This could be due to piece availability or scheduling conflicts.</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #888;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Reason</span><br><span style="color:#ccc;font-size:14px;">${note}</span></div>` : ''}
        <p>Please feel free to submit a new request when you're ready.</p>
      `),
    };
  },

  // 8. Subscription confirmation
  subscriptionConfirmed(user, plan) {
    const planLabels = {
      standard_monthly: 'Standard (Monthly)',
      standard_yearly: 'Standard (Yearly)',
      premium_monthly: 'Premium (Monthly)',
      premium_yearly: 'Premium (Yearly)',
    };
    return {
      subject: 'Subscription Confirmed',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Subscription Active</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Your <strong style="color:#fff;">${planLabels[plan] || plan}</strong> subscription is now active.</p>
        <p>You now have access to all subscriber-exclusive content and features.</p>
        <a href="${FRONTEND_URL}/subscribe.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">MANAGE SUBSCRIPTION</a>
      `),
    };
  },

  // ── Marketing newsletter templates ────────────────────────────────
  // Used by /api/cron/send-due-campaigns. Each takes the campaign row
  // (with payload), the recipient profile, and an unsubscribe token so
  // every email body carries a working one-click opt-out link.
  // Marketing wrapper (different from wrapHtml): light "footer" with
  // sender info + unsubscribe link as required by 정보통신망법 §50.

  weeklyEditorial: (campaign, user, unsubToken) => {
    const eds = (campaign.payload && campaign.payload.editorials) || [];
    const cards = eds.map(ed => `
      <tr><td style="padding-bottom:24px;">
        <a href="${FRONTEND_URL}/editorial/${encodeURIComponent(ed.slug || ed.id)}" style="text-decoration:none;color:inherit;display:block;">
          <img src="${ed.image}" alt="${escapeHtml(ed.title)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;">
          <div style="padding:14px 4px 0;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#888;text-transform:uppercase;">${escapeHtml(ed.tagline || 'EDITORIAL')}</div>
            <div style="font-size:18px;font-weight:700;color:#fff;margin-top:6px;letter-spacing:.5px;">${escapeHtml(ed.title)}</div>
            ${ed.credit ? `<div style="font-size:11px;color:#777;margin-top:6px;">${escapeHtml(ed.credit)}</div>` : ''}
          </div>
        </a>
      </td></tr>
    `).join('');

    const greeting = user && user.display_name ? user.display_name : (user && user.email ? user.email.split('@')[0] : 'PAP Reader');
    return {
      subject: campaign.subject,
      html: wrapMarketing({
        preheader: campaign.preheader || '이주의 PAP 에디토리얼',
        body: `
          <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">THIS WEEK&apos;S EDITORIALS</div>
          <h1 style="font-size:26px;color:#fff;margin:0 0 8px;letter-spacing:.5px;line-height:1.25;">${escapeHtml(campaign.hero_headline || '이주의 에디토리얼')}</h1>
          <p style="color:#999;font-size:13px;line-height:1.7;margin:0 0 24px;">${escapeHtml(campaign.hero_body || '')}</p>
          <div style="font-size:12px;color:#aaa;margin-bottom:24px;">안녕하세요, <strong style="color:#fff;">${escapeHtml(greeting)}</strong>님.</div>
          <table width="100%" cellpadding="0" cellspacing="0">${cards}</table>
          <a href="${FRONTEND_URL}/" style="display:inline-block;background:#fff;color:#000;padding:14px 36px;font-size:11px;font-weight:700;letter-spacing:2px;text-decoration:none;margin-top:8px;">VIEW MORE ON PAP</a>
        `,
        unsubUrl: `${FRONTEND_URL}/api/auth/unsubscribe?token=${unsubToken}`,
      }),
    };
  },

  // ── Weekly news (이주의 뉴스) ──────────────────────────────────
  // Uses the PAP Daily Briefing visual identity (brown header, numbered
  // circular badges, ART · FASHION · BEAUTY · CULTURE divider, dark
  // footer) so the weekly digest reads like an extension of the same
  // editorial product. Per editorial direction, the per-item SOURCE —
  // DATE line is NOT rendered (we don't want to advertise where the
  // raw news came from in a marketing email). The mandatory
  // unsubscribe link still lives in the footer below.
  //
  // i18n: when campaign.payload.i18n is present (AI-generated weekly
  // campaigns produce all 9 site locales), pick the recipient's
  // language → fall back to 'en' → fall back to the flat payload
  // shape (manual single-language campaigns). The pickI18n() helper
  // makes the fallback chain explicit.
  weeklyNews: (campaign, user, unsubToken) => {
    const lang = (user && user.language) || 'en';
    const view = pickI18nForWeekly(campaign, lang);
    const items = view.newsItems;
    const headerDate = (campaign.payload && campaign.payload.headerDate) || (() => {
      const d = new Date();
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    })();
    const issueLabel = (campaign.payload && campaign.payload.issueLabel) || 'Weekly Briefing';
    const subject = view.subject || campaign.subject;
    const preheader = view.preheader || campaign.preheader || 'PAP Weekly News';

    const cards = items.map((n, i) => `
      <tr><td style="padding:24px 28px 0;">
        <div style="display:inline-block;background:#6b1a1a;color:#ffffff;font-size:11px;font-weight:700;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;margin-bottom:8px;">${String(i+1).padStart(2,'0')}</div>
        <div style="font-size:17px;font-weight:700;color:#1a1a1a;line-height:1.4;margin-bottom:6px;">${escapeHtml(n.title || '')}</div>
        ${n.summary ? `<div style="font-size:13.5px;color:#444;line-height:1.7;margin-bottom:4px;">${escapeHtml(n.summary)}</div>` : ''}
      </td></tr>
    `).join('');

    // PAP Daily Briefing HTML — preserved byte-for-byte except for:
    //   1) date string says <issueLabel> — <headerDate>
    //   2) per-item SOURCE — DATE line removed
    //   3) added an unsubscribe row above the dark footer (legal requirement)
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PAP Weekly News</title></head>
<body style="margin:0;padding:0;background:#f5f0eb;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:'Inter',Helvetica,Arial,sans-serif;background:#ffffff;">
    <tr><td align="center" style="background-color:#6b1a1a;padding:28px 20px"><img src="https://lh3.googleusercontent.com/d/1IAVkzs1uAj10kM0P3h64ItZvB924WkET" width="50" style="display:block;" alt="PAP"></td></tr>
    <tr><td align="center" style="background-color:#f5f0eb;padding:14px 20px;font-size:10px;font-weight:600;color:#6b1a1a;letter-spacing:4px;">ART &middot; FASHION &middot; BEAUTY &middot; CULTURE</td></tr>
    <tr><td align="center" style="background-color:#f5f0eb;padding:0 20px 18px;font-size:13px;color:#999;">${escapeHtml(issueLabel)} &mdash; ${escapeHtml(headerDate)}</td></tr>
    ${cards}
    <tr><td style="padding:18px 28px 0;"><hr style="border:none;border-top:1px solid #eee;"></td></tr>
    <!-- Legal: unsubscribe + sender info, required for marketing email -->
    <tr><td style="padding:18px 28px 0;font-size:11px;color:#888;line-height:1.6;">
      본 메일은 PAP Magazine에 가입하시고 <strong style="color:#555;">이메일 수신에 동의</strong>하신 회원에게 발송됩니다.
      &nbsp;·&nbsp;
      <a href="${FRONTEND_URL}/api/auth/unsubscribe?token=${unsubToken}" style="color:#6b1a1a;text-decoration:underline;">수신 거부</a>
      &nbsp;·&nbsp;
      <a href="${FRONTEND_URL}/mypage#mp-preferences" style="color:#6b1a1a;text-decoration:underline;">알림 설정 변경</a>
    </td></tr>
    <tr><td align="center" style="background-color:#1a1a1a;padding:28px 20px;margin-top:18px;">
      <div style="font-size:11px;font-weight:700;color:#ffffff;letter-spacing:4px;">P A P &nbsp; M A G A Z I N E</div>
      <div style="font-size:11px;color:#888;margin-top:6px;">pap-magazine.com | @pap_magazine</div>
    </td></tr>
  </table>
</body>
</html>`;
    return { subject, html };
  },
};

// ── i18n picker for weeklyNews ────────────────────────────────────
// Resolves the "what content should THIS recipient see" question with
// a four-step fallback chain:
//   1) campaign.payload.i18n[lang]  — exact-match locale
//   2) campaign.payload.i18n.en     — English fallback (the canonical
//      default for any locale not in our supported set)
//   3) campaign.payload.{subject, newsItems, ...} — flat payload from
//      manually-created single-language campaigns
//   4) campaign.{subject, preheader, ...} — last-resort top-level fields
//
// Anything missing falls through to the next step, so a half-translated
// campaign still renders SOMETHING readable rather than crashing.
function pickI18nForWeekly(campaign, lang) {
  const payload = campaign.payload || {};
  const i18n = payload.i18n;
  const flatItems = Array.isArray(payload.newsItems) ? payload.newsItems : [];
  if (i18n && typeof i18n === 'object') {
    const pref = i18n[lang] || i18n.en || {};
    return {
      subject:       pref.subject       || campaign.subject || '',
      preheader:     pref.preheader     || campaign.preheader || '',
      hero_headline: pref.hero_headline || campaign.hero_headline || '',
      hero_body:     pref.hero_body     || campaign.hero_body || '',
      newsItems:     Array.isArray(pref.newsItems) ? pref.newsItems
                    : (Array.isArray(i18n.en && i18n.en.newsItems) ? i18n.en.newsItems
                    : flatItems),
    };
  }
  // Legacy single-language campaign (admin typed in one locale via the UI)
  return {
    subject: campaign.subject || '',
    preheader: campaign.preheader || '',
    hero_headline: campaign.hero_headline || '',
    hero_body: campaign.hero_body || '',
    newsItems: flatItems,
  };
}

// ── Marketing wrapper ─────────────────────────────────────────────
// Distinct from wrapHtml(): adds preheader text (preview snippet in
// Gmail/Outlook inbox), an unsubscribe link in the footer, and the
// sender-info block required by 정보통신망법 §50.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function wrapMarketing({ preheader, body, unsubUrl }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>PAP Magazine</title>
</head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <!-- preheader (hidden but used as inbox preview) -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader || '')}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #1a1a1a;max-width:600px;">
        <tr><td style="padding:28px 36px 20px;border-bottom:1px solid #1a1a1a;">
          <a href="${FRONTEND_URL}" style="color:#fff;font-size:24px;font-weight:700;letter-spacing:8px;text-decoration:none;">PAP</a>
        </td></tr>
        <tr><td style="padding:32px 36px;color:#ccc;font-size:14px;line-height:1.7;">${body}</td></tr>
        <tr><td style="padding:28px 36px;border-top:1px solid #1a1a1a;color:#666;font-size:11px;line-height:1.6;">
          <p style="margin:0 0 14px;color:#888;">
            본 메일은 PAP Magazine에 가입하시고 <strong style="color:#aaa;">이메일 수신에 동의</strong>하신 회원에게 발송됩니다.
          </p>
          <p style="margin:0 0 14px;">
            <a href="${unsubUrl}" style="color:#bbb;text-decoration:underline;">수신 거부 / Unsubscribe</a>
            &nbsp;·&nbsp;
            <a href="${FRONTEND_URL}/mypage#mp-preferences" style="color:#bbb;text-decoration:underline;">알림 설정 변경</a>
          </p>
          <p style="margin:0;color:#555;font-size:10px;line-height:1.5;">
            PAP Magazine · contact@pap-magazine.com · ${FRONTEND_URL}<br>
            &copy; ${new Date().getFullYear()} PAP Magazine. All rights reserved.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Send function ──
async function sendEmail(to, template) {
  // Skip if SMTP is not configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[EMAIL] SMTP not configured, skipping email to:', to);
    return { skipped: true };
  }

  try {
    const info = await getTransporter().sendMail({
      from: FROM,
      to,
      subject: template.subject,
      html: template.html,
    });
    console.log('[EMAIL] Sent:', template.subject, 'to:', to, 'id:', info.messageId);
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed:', error.message);
    // Don't throw — email failure shouldn't break the API
    return { sent: false, error: error.message };
  }
}

module.exports = { sendEmail, templates };
