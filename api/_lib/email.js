/**
 * PAP Magazine - Email Service
 * Nodemailer-based transactional email sender
 */

const { SUPPORTED_LANGS, LANG_LABELS, emailUiStrings } = require('./emailLocale');

/* nodemailer 는 실제로 메일을 보낼 때만 불러온다 (2026-07-30 CI 실패 후 수정).
 *
 * CI(.github/workflows/test.yml)는 `npm ci` 를 하지 않는다 — 하네스 테스트는
 * node_modules 없이 도는 것이 설계다(테스트는 supabase 등 무거운 의존을
 * require.cache 주입으로 스텁한다). 그런데 이 파일이 최상단에서 nodemailer 를
 * 요구하면, 이 파일을 (직접 아니라도) 체인으로 끌어오는 테스트가 CI 에서
 * MODULE_NOT_FOUND 로 죽는다.
 *   실제 사례: backfill-translations 크론을 withCronGuard 로 감싼 순간
 *   cronGuard → email → nodemailer 체인이 생겨 seo-translate-backfill 테스트가
 *   CI 에서만 죽었다(로컬은 node_modules 가 있어 통과).
 * 지연 로드로 두면 "메일을 보내지 않는 코드 경로"는 nodemailer 를 필요로 하지
 * 않는다. 로컬 검증은 반드시 node_modules 없는 클린 클론에서 할 것. */
let transporter = null;

function getTransporter() {
  if (!transporter) {
    const nodemailer = require('nodemailer');
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
/* 2026-08-08 — 성장 헌법 3조: 이메일→웹 링크는 전부 utm=newsletter 로 계측한다.
   화이트리스트(socialInclick.js)에 자리만 있고 아무도 안 보내던 유령 채널이었다.
   이메일→IG(FOLLOW 버튼)는 /api/ig-out?src=newsletter 경유 — 플라이휠 양방향 계측. */
const UTM_MAIL = 'utm_source=newsletter&utm_medium=email';
const withMailUtm = (u) => u + (String(u).includes('?') ? '&' : '?') + UTM_MAIL;
const IG_FOLLOW_MAIL = FRONTEND_URL + '/api/ig-out?src=newsletter&to=profile&url=' + encodeURIComponent('https://www.instagram.com/pap_magazine/');

/* 2026-08-03 — 서브미션 거절 기본 문구 (도메니코 지시, 영문 원문 그대로).
 * 실측 배경: rejected 32건 중 30건이 admin_notes 공란이었다. 즉 거절된 작가는
 * MY SUBMISSIONS 에서도 메일에서도 아무 설명을 못 받았다. 이제 심사자가 별도
 * 메모를 남기지 않으면 이 편지가 자동으로 들어간다.
 *
 * 노출 경로는 웹 한 곳뿐이다:
 *   submissions.admin_notes 기본값 → MY SUBMISSIONS 에 노출
 *   (api/submissions/[id]/review.js 의 reviewPatch)
 *
 * 2026-08-03 도메니코 결정 — 메일에는 넣지 않는다. 심사 결과를 수신함에
 * 드러내지 않는 기존 설계(QA #165)를 그대로 유지하고, 거절 안내는 작가가
 * 직접 MY SUBMISSIONS 에 들어와 확인하게 한다. 그래서 REJECTION_LETTER_BODY
 * 는 메일 템플릿이 아니라 admin_notes 조립과 회귀 테스트에서만 쓰인다.
 *
 * 편지 전문(DEFAULT_REJECTION_NOTE)은 도메니코 원문의 줄바꿈까지 그대로
 * 복원한다. 본문 5줄은 REJECTION_LETTER_BODY 가 단일 소스다. */
const REJECTION_LETTER_BODY = [
  'Thank you for your email and for sharing your materials with us. Unfortunately, It does not quite align with our aesthetic standard.',
  'Please rest assured that any images not selected for publication will remain private and will be promptly deleted.',
  'We truly appreciate your kind offer and hope for the opportunity to collaborate again in the future.',
  'All the best,',
  'PAP Magazine Editorial Team,',
];

const DEFAULT_REJECTION_NOTE = [
  'Dear,',
  '',
  REJECTION_LETTER_BODY[0],
  REJECTION_LETTER_BODY[1],
  '',
  REJECTION_LETTER_BODY[2],
  REJECTION_LETTER_BODY[3],
  '',
  REJECTION_LETTER_BODY[4],
].join('\n');

// ── Shared HTML wrapper ──
function wrapHtml(content, lang) {
  const _ui = emailUiStrings(lang || 'en');
  const _igTag = _ui.igFollowTagline || "New editorials and fashion news, every day —<br>see them first on Instagram.";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;">
  <!-- Header -->
  <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #222;">
    <a href="${withMailUtm(FRONTEND_URL)}" style="color:#fff;font-size:28px;font-weight:700;letter-spacing:8px;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">PAP</a>
  </td></tr>
  <!-- Content -->
  <tr><td style="padding:32px 40px;color:#ccc;font-size:14px;line-height:1.7;">
    ${content}
  </td></tr>
  <!-- IG 팔로우 CTA (2026-07 성장 깔때기) — 모든 발신 메일 공통.
       회원 메일은 열람률이 높은 접점이라 팔로워 전환 효율이 좋다. -->
  <tr><td align="center" style="padding:26px 40px;border-top:1px solid #222;">
    <div style="color:#888;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;">PAP Magazine — Instagram</div>
    <div style="color:#ccc;font-size:13px;line-height:1.7;margin-bottom:16px;">${_igTag}</div>
    <a href="${IG_FOLLOW_MAIL}" style="display:inline-block;background:#fff;color:#000;padding:11px 28px;font-size:11px;font-weight:700;letter-spacing:2px;text-decoration:none;">FOLLOW @PAP_MAGAZINE</a>
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:24px 40px;border-top:1px solid #222;color:#666;font-size:11px;line-height:1.5;">
    &copy; ${new Date().getFullYear()} PAP Magazine. All rights reserved.<br>
    <a href="${withMailUtm(FRONTEND_URL)}" style="color:#888;text-decoration:none;">www.pap-magazine.com</a>
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
    payTitle: '게재료 결제 요청',
    payBody: '이 에디토리얼은 유료 게재 대상으로, 게재를 확정하려면 게재료 {amt} 결제가 필요합니다. 위 MY SUBMISSIONS에서 결제를 진행해 주세요.',
    apSubject: '축하드립니다 — "{title}" 게재가 승인되었습니다',
    apHeading: '게재가 승인되었습니다',
    apCongrats: '축하드립니다! 보내주신 작품 {title}의 게재가 승인되었습니다.',
    apCongratsPaid: '축하드립니다! 보내주신 작품 {title}의 유료 게재가 승인되었습니다.',
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
    payTitle: 'Publication Fee — Payment Requested',
    payBody: 'This editorial requires a publication fee of {amt} to confirm publication. Please complete the payment in MY SUBMISSIONS above.',
    apSubject: 'Congratulations — your submission "{title}" has been approved',
    apHeading: 'Your Submission Is Approved',
    apCongrats: 'Congratulations! Your submission {title} has been approved for publication.',
    apCongratsPaid: 'Congratulations! Your submission {title} has been approved for paid publication.',
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
    payTitle: 'Tariffa di pubblicazione — Pagamento richiesto',
    payBody: 'Questo editoriale richiede una tariffa di pubblicazione di {amt} per confermare la pubblicazione. Completa il pagamento in MY SUBMISSIONS qui sopra.',
    apSubject: 'Congratulazioni — il tuo invio "{title}" è stato approvato',
    apHeading: 'Il tuo invio è approvato',
    apCongrats: 'Congratulazioni! Il tuo invio {title} è stato approvato per la pubblicazione.',
    apCongratsPaid: 'Congratulazioni! Il tuo invio {title} è stato approvato per la pubblicazione a pagamento.',
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
    payTitle: 'Frais de publication — Paiement demandé',
    payBody: 'Cet éditorial nécessite des frais de publication de {amt} pour confirmer la publication. Veuillez effectuer le paiement dans MY SUBMISSIONS ci-dessus.',
    apSubject: 'Félicitations — votre soumission "{title}" a été approuvée',
    apHeading: 'Votre soumission est approuvée',
    apCongrats: 'Félicitations ! Votre soumission {title} a été approuvée pour publication.',
    apCongratsPaid: 'Félicitations ! Votre soumission {title} a été approuvée pour une publication payante.',
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
    payTitle: 'Tarifa de publicación — Pago solicitado',
    payBody: 'Este editorial requiere una tarifa de publicación de {amt} para confirmar la publicación. Completa el pago en MY SUBMISSIONS más arriba.',
    apSubject: 'Enhorabuena — tu envío "{title}" ha sido aprobado',
    apHeading: 'Tu envío ha sido aprobado',
    apCongrats: '¡Enhorabuena! Tu envío {title} ha sido aprobado para su publicación.',
    apCongratsPaid: '¡Enhorabuena! Tu envío {title} ha sido aprobado para su publicación de pago.',
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
    payTitle: '掲載料のお支払いのお願い',
    payBody: 'この作品は有料掲載の対象です。掲載を確定するには掲載料 {amt} のお支払いが必要です。上の MY SUBMISSIONS からお支払いください。',
    apSubject: 'おめでとうございます — "{title}" の掲載が承認されました',
    apHeading: '掲載が承認されました',
    apCongrats: 'おめでとうございます！ご投稿いただいた作品 {title} の掲載が承認されました。',
    apCongratsPaid: 'おめでとうございます！ご投稿いただいた作品 {title} の有料掲載が承認されました。',
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
    payTitle: '刊登费 — 需要付款',
    payBody: '本作品需支付刊登费 {amt} 以确认刊登。请在上方 MY SUBMISSIONS 中完成付款。',
    apSubject: '恭喜 — 您的投稿 "{title}" 已通过审核',
    apHeading: '投稿已通过审核',
    apCongrats: '恭喜！您提交的作品 {title} 已通过审核并将刊登。',
    apCongratsPaid: '恭喜！您提交的作品 {title} 已通过审核，将进行付费刊登。',
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
    payTitle: 'Плата за публикацию — требуется оплата',
    payBody: 'Для подтверждения публикации этого материала требуется плата за публикацию в размере {amt}. Пожалуйста, завершите оплату в разделе MY SUBMISSIONS выше.',
    apSubject: 'Поздравляем — ваша работа "{title}" одобрена',
    apHeading: 'Ваша работа одобрена',
    apCongrats: 'Поздравляем! Ваша работа {title} одобрена к публикации.',
    apCongratsPaid: 'Поздравляем! Ваша работа {title} одобрена к платной публикации.',
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
    payTitle: 'Veröffentlichungsgebühr — Zahlung erforderlich',
    payBody: 'Für die Bestätigung der Veröffentlichung ist eine Gebühr von {amt} erforderlich. Bitte schließe die Zahlung oben in MY SUBMISSIONS ab.',
    apSubject: 'Herzlichen Glückwunsch — deine Einreichung "{title}" wurde angenommen',
    apHeading: 'Deine Einreichung ist angenommen',
    apCongrats: 'Herzlichen Glückwunsch! Deine Einreichung {title} wurde zur Veröffentlichung angenommen.',
    apCongratsPaid: 'Herzlichen Glückwunsch! Deine Einreichung {title} wurde zur kostenpflichtigen Veröffentlichung angenommen.',
  },
};

// ── Email Templates ──

// i18n for Pull-Letter + Subscription emails (2026-07-11) — 수신자 언어 통일
const PULLLETTER_I18N = {
  "ko": {
    "received": {
      "subject": "Pull-Letter 요청이 접수되었습니다",
      "heading": "Pull-Letter 요청 접수",
      "body1": "Pull-Letter 요청이 접수되었습니다. 담당 팀이 요청하신 제품의 대여 가능 여부를 확인하고 관련 쇼룸과 조율하겠습니다.",
      "statusLabel": "상태",
      "statusValue": "처리 중",
      "eta": "검토 결과는 영업일 기준 7일 이내에 이메일로 안내드립니다.",
      "body2": "Pull이 확정되면 다음 단계를 안내드리겠습니다."
    },
    "accepted": {
      "subject": "Pull-Letter가 승인되었습니다",
      "heading": "Pull-Letter 승인",
      "body1": "Pull-Letter 요청이 승인되었습니다. 쇼룸과 의상 전달 일정을 조율하겠습니다.",
      "detailsLabel": "상세",
      "cta": "요청 보기"
    },
    "rejected": {
      "subject": "Pull-Letter 요청 안내",
      "heading": "Pull-Letter 안내",
      "body1": "죄송합니다. 현재 Pull-Letter 요청을 진행하기 어렵습니다. 제품 대여 가능 여부 또는 일정 문제일 수 있습니다.",
      "reasonLabel": "사유",
      "body2": "준비가 되시면 언제든 새로운 요청을 제출해 주세요."
    }
  },
  "en": {
    "received": {
      "subject": "Pull-Letter Request Received",
      "heading": "Pull-Letter Request Received",
      "body1": "Your pull-letter request has been received. Our team will review the availability of the requested pieces and coordinate with the relevant showrooms.",
      "statusLabel": "Status",
      "statusValue": "Processing",
      "eta": "You will hear back from us within 7 business days.",
      "body2": "We'll reach out with next steps once the pull has been confirmed."
    },
    "accepted": {
      "subject": "Pull-Letter Approved",
      "heading": "Pull-Letter Approved",
      "body1": "Your pull-letter request has been approved. We will coordinate the delivery of the garments with the showroom.",
      "detailsLabel": "Details",
      "cta": "VIEW REQUESTS"
    },
    "rejected": {
      "subject": "Pull-Letter Request Update",
      "heading": "Pull-Letter Update",
      "body1": "Unfortunately, we're unable to fulfill your pull-letter request at this time. This could be due to piece availability or scheduling conflicts.",
      "reasonLabel": "Reason",
      "body2": "Please feel free to submit a new request when you're ready."
    }
  },
  "it": {
    "received": {
      "subject": "Richiesta Pull-Letter ricevuta",
      "heading": "Richiesta Pull-Letter ricevuta",
      "body1": "La tua richiesta di pull-letter è stata ricevuta. Il nostro team verificherà la disponibilità dei capi richiesti e si coordinerà con gli showroom.",
      "statusLabel": "Stato",
      "statusValue": "In elaborazione",
      "eta": "Riceverai una risposta entro 7 giorni lavorativi.",
      "body2": "Ti contatteremo con i prossimi passi una volta confermato il pull."
    },
    "accepted": {
      "subject": "Pull-Letter approvata",
      "heading": "Pull-Letter approvata",
      "body1": "La tua richiesta di pull-letter è stata approvata. Coordineremo la consegna dei capi con lo showroom.",
      "detailsLabel": "Dettagli",
      "cta": "VEDI RICHIESTE"
    },
    "rejected": {
      "subject": "Aggiornamento richiesta Pull-Letter",
      "heading": "Aggiornamento Pull-Letter",
      "body1": "Purtroppo non possiamo soddisfare la tua richiesta di pull-letter in questo momento, per disponibilità dei capi o conflitti di programmazione.",
      "reasonLabel": "Motivo",
      "body2": "Sentiti libero di inviare una nuova richiesta quando vuoi."
    }
  },
  "fr": {
    "received": {
      "subject": "Demande Pull-Letter reçue",
      "heading": "Demande Pull-Letter reçue",
      "body1": "Votre demande de pull-letter a bien été reçue. Notre équipe vérifiera la disponibilité des pièces demandées et se coordonnera avec les showrooms concernés.",
      "statusLabel": "Statut",
      "statusValue": "En cours",
      "eta": "Vous recevrez une réponse sous 7 jours ouvrés.",
      "body2": "Nous vous recontacterons avec les prochaines étapes une fois le pull confirmé."
    },
    "accepted": {
      "subject": "Pull-Letter approuvée",
      "heading": "Pull-Letter approuvée",
      "body1": "Votre demande de pull-letter a été approuvée. Nous coordonnerons la livraison des pièces avec le showroom.",
      "detailsLabel": "Détails",
      "cta": "VOIR LES DEMANDES"
    },
    "rejected": {
      "subject": "Mise à jour de la demande Pull-Letter",
      "heading": "Mise à jour Pull-Letter",
      "body1": "Malheureusement, nous ne pouvons pas répondre à votre demande de pull-letter pour le moment, en raison de la disponibilité des pièces ou de contraintes de planning.",
      "reasonLabel": "Motif",
      "body2": "N'hésitez pas à soumettre une nouvelle demande quand vous le souhaitez."
    }
  },
  "es": {
    "received": {
      "subject": "Solicitud de Pull-Letter recibida",
      "heading": "Solicitud de Pull-Letter recibida",
      "body1": "Hemos recibido tu solicitud de pull-letter. Nuestro equipo verificará la disponibilidad de las piezas solicitadas y coordinará con los showrooms correspondientes.",
      "statusLabel": "Estado",
      "statusValue": "En proceso",
      "eta": "Recibirás una respuesta en un plazo de 7 días hábiles.",
      "body2": "Nos pondremos en contacto con los próximos pasos una vez confirmado el pull."
    },
    "accepted": {
      "subject": "Pull-Letter aprobada",
      "heading": "Pull-Letter aprobada",
      "body1": "Tu solicitud de pull-letter ha sido aprobada. Coordinaremos la entrega de las prendas con el showroom.",
      "detailsLabel": "Detalles",
      "cta": "VER SOLICITUDES"
    },
    "rejected": {
      "subject": "Actualización de la solicitud de Pull-Letter",
      "heading": "Actualización de Pull-Letter",
      "body1": "Lamentablemente, no podemos atender tu solicitud de pull-letter en este momento, por disponibilidad de las piezas o conflictos de agenda.",
      "reasonLabel": "Motivo",
      "body2": "No dudes en enviar una nueva solicitud cuando quieras."
    }
  },
  "ja": {
    "received": {
      "subject": "Pull-Letterのリクエストを受け付けました",
      "heading": "Pull-Letter リクエスト受付",
      "body1": "Pull-Letterのリクエストを受け付けました。担当チームがリクエストされたアイテムの貸出可否を確認し、関連ショールームと調整いたします。",
      "statusLabel": "ステータス",
      "statusValue": "処理中",
      "eta": "審査結果は7営業日以内にメールでご連絡いたします。",
      "body2": "Pullが確定次第、次のステップをご案内いたします。"
    },
    "accepted": {
      "subject": "Pull-Letterが承認されました",
      "heading": "Pull-Letter 承認",
      "body1": "Pull-Letterのリクエストが承認されました。ショールームと衣装のお届けを調整いたします。",
      "detailsLabel": "詳細",
      "cta": "リクエストを見る"
    },
    "rejected": {
      "subject": "Pull-Letterリクエストのお知らせ",
      "heading": "Pull-Letter のお知らせ",
      "body1": "申し訳ございませんが、現在Pull-Letterのリクエストにお応えできません。アイテムの貸出状況またはスケジュールの都合による場合があります。",
      "reasonLabel": "理由",
      "body2": "ご準備が整いましたら、いつでも新しいリクエストをお送りください。"
    }
  },
  "zh": {
    "received": {
      "subject": "已收到 Pull-Letter 申请",
      "heading": "已收到 Pull-Letter 申请",
      "body1": "我们已收到您的 pull-letter 申请。团队将确认所申请单品的可借用情况，并与相关 showroom 进行协调。",
      "statusLabel": "状态",
      "statusValue": "处理中",
      "eta": "我们将在7个工作日内通过邮件告知审核结果。",
      "body2": "确认借调后，我们将与您沟通后续步骤。"
    },
    "accepted": {
      "subject": "Pull-Letter 已批准",
      "heading": "Pull-Letter 已批准",
      "body1": "您的 pull-letter 申请已获批准。我们将与 showroom 协调服装的交付。",
      "detailsLabel": "详情",
      "cta": "查看申请"
    },
    "rejected": {
      "subject": "Pull-Letter 申请更新",
      "heading": "Pull-Letter 更新",
      "body1": "很抱歉，我们目前无法满足您的 pull-letter 申请，可能是由于单品可借用情况或档期冲突。",
      "reasonLabel": "原因",
      "body2": "准备就绪后，欢迎随时提交新的申请。"
    }
  },
  "ru": {
    "received": {
      "subject": "Запрос Pull-Letter получен",
      "heading": "Запрос Pull-Letter получен",
      "body1": "Ваш запрос pull-letter получен. Наша команда проверит доступность запрошенных вещей и согласует детали с соответствующими шоурумами.",
      "statusLabel": "Статус",
      "statusValue": "В обработке",
      "eta": "Мы сообщим вам о решении в течение 7 рабочих дней.",
      "body2": "Мы свяжемся с вами и сообщим о следующих шагах после подтверждения."
    },
    "accepted": {
      "subject": "Pull-Letter одобрен",
      "heading": "Pull-Letter одобрен",
      "body1": "Ваш запрос pull-letter одобрен. Мы согласуем доставку вещей с шоурумом.",
      "detailsLabel": "Детали",
      "cta": "СМОТРЕТЬ ЗАПРОСЫ"
    },
    "rejected": {
      "subject": "Обновление запроса Pull-Letter",
      "heading": "Обновление Pull-Letter",
      "body1": "К сожалению, сейчас мы не можем выполнить ваш запрос pull-letter — из-за доступности вещей или несовпадения сроков.",
      "reasonLabel": "Причина",
      "body2": "Вы можете отправить новый запрос в любое удобное время."
    }
  },
  "de": {
    "received": {
      "subject": "Pull-Letter-Anfrage erhalten",
      "heading": "Pull-Letter-Anfrage erhalten",
      "body1": "Deine Pull-Letter-Anfrage ist eingegangen. Unser Team prüft die Verfügbarkeit der angefragten Teile und stimmt sich mit den entsprechenden Showrooms ab.",
      "statusLabel": "Status",
      "statusValue": "In Bearbeitung",
      "eta": "Sie erhalten innerhalb von 7 Werktagen eine Rückmeldung.",
      "body2": "Sobald der Pull bestätigt ist, melden wir uns mit den nächsten Schritten."
    },
    "accepted": {
      "subject": "Pull-Letter genehmigt",
      "heading": "Pull-Letter genehmigt",
      "body1": "Deine Pull-Letter-Anfrage wurde genehmigt. Wir koordinieren die Lieferung der Teile mit dem Showroom.",
      "detailsLabel": "Details",
      "cta": "ANFRAGEN ANSEHEN"
    },
    "rejected": {
      "subject": "Update zu deiner Pull-Letter-Anfrage",
      "heading": "Pull-Letter-Update",
      "body1": "Leider können wir deine Pull-Letter-Anfrage derzeit nicht erfüllen – aufgrund der Verfügbarkeit der Teile oder terminlicher Überschneidungen.",
      "reasonLabel": "Grund",
      "body2": "Du kannst jederzeit gerne eine neue Anfrage stellen."
    }
  }
};

const SUBSCRIPTION_I18N = {
  "ko": {
    "subject": "구독이 확정되었습니다",
    "heading": "구독이 활성화되었습니다",
    "body1": "{plan} 구독이 지금 활성화되었습니다.",
    "body2": "이제 구독자 전용 콘텐츠와 기능을 모두 이용하실 수 있습니다.",
    "cta": "구독 관리"
  },
  "en": {
    "subject": "Subscription Confirmed",
    "heading": "Subscription Active",
    "body1": "Your {plan} subscription is now active.",
    "body2": "You now have access to all subscriber-exclusive content and features.",
    "cta": "MANAGE SUBSCRIPTION"
  },
  "it": {
    "subject": "Abbonamento confermato",
    "heading": "Abbonamento attivo",
    "body1": "Il tuo abbonamento {plan} è ora attivo.",
    "body2": "Ora hai accesso a tutti i contenuti e le funzionalità riservati agli abbonati.",
    "cta": "GESTISCI ABBONAMENTO"
  },
  "fr": {
    "subject": "Abonnement confirmé",
    "heading": "Abonnement actif",
    "body1": "Votre abonnement {plan} est désormais actif.",
    "body2": "Vous avez maintenant accès à tous les contenus et fonctionnalités réservés aux abonnés.",
    "cta": "GÉRER L'ABONNEMENT"
  },
  "es": {
    "subject": "Suscripción confirmada",
    "heading": "Suscripción activa",
    "body1": "Tu suscripción {plan} ya está activa.",
    "body2": "Ahora tienes acceso a todo el contenido y las funciones exclusivas para suscriptores.",
    "cta": "GESTIONAR SUSCRIPCIÓN"
  },
  "ja": {
    "subject": "サブスクリプションが確定しました",
    "heading": "サブスクリプション有効",
    "body1": "{plan} サブスクリプションが有効になりました。",
    "body2": "これで購読者限定のコンテンツと機能をすべてご利用いただけます。",
    "cta": "サブスクリプション管理"
  },
  "zh": {
    "subject": "订阅已确认",
    "heading": "订阅已生效",
    "body1": "您的 {plan} 订阅现已生效。",
    "body2": "您现在可以访问所有订阅者专享内容与功能。",
    "cta": "管理订阅"
  },
  "ru": {
    "subject": "Подписка подтверждена",
    "heading": "Подписка активна",
    "body1": "Ваша подписка {plan} теперь активна.",
    "body2": "Теперь вам доступны все материалы и функции для подписчиков.",
    "cta": "УПРАВЛЕНИЕ ПОДПИСКОЙ"
  },
  "de": {
    "subject": "Abonnement bestätigt",
    "heading": "Abonnement aktiv",
    "body1": "Dein {plan}-Abonnement ist jetzt aktiv.",
    "body2": "Du hast jetzt Zugriff auf alle exklusiven Inhalte und Funktionen für Abonnenten.",
    "cta": "ABONNEMENT VERWALTEN"
  }
};

// B-3 (2026-07-26 감사) — 발급(issued) 전용 다국어 카피. 예전엔 'accepted'
// 템플릿을 재사용해 "승인" 문구가 나갔다. 발급 완료 = PDF 다운로드 안내가 맞다.
const TRIAL_ENDING_I18N = {
  "ko": {
    "subject": "무료체험이 {days}일 후 종료됩니다",
    "heading": "무료체험 종료 안내",
    "body1": "{plan} 무료체험이 <strong style=\"color:#fff;\">{date}</strong>에 종료되며, 같은 날 첫 결제가 진행됩니다.",
    "body2": "계속 이용하시려면 아무 조치도 필요하지 않습니다. 원하지 않으시면 종료일 전까지 구독 관리 페이지에서 언제든 해지하실 수 있습니다.",
    "note": "Pull-Letter는 첫 결제가 확인된 뒤 발급되며, 신청은 월 1건까지 가능합니다.",
    "cta": "구독 관리"
  },
  "en": {
    "subject": "Your free trial ends in {days} days",
    "heading": "Free Trial Ending Soon",
    "body1": "Your {plan} free trial ends on <strong style=\"color:#fff;\">{date}</strong>, and the first payment will be charged the same day.",
    "body2": "No action is needed if you wish to continue. If you would rather not, you can cancel any time before that date from your subscription page.",
    "note": "Pull-Letters are issued after the first payment is confirmed, and requests are limited to 1 per month.",
    "cta": "MANAGE SUBSCRIPTION"
  },
  "it": {
    "subject": "La tua prova gratuita termina tra {days} giorni",
    "heading": "La prova gratuita sta per terminare",
    "body1": "La tua prova gratuita {plan} termina il <strong style=\"color:#fff;\">{date}</strong> e lo stesso giorno verrà addebitato il primo pagamento.",
    "body2": "Non devi fare nulla se desideri continuare. In caso contrario, puoi disdire in qualsiasi momento prima di quella data dalla pagina abbonamento.",
    "note": "La Pull-Letter viene emessa dopo la conferma del primo pagamento e le richieste sono limitate a 1 al mese.",
    "cta": "GESTISCI ABBONAMENTO"
  },
  "fr": {
    "subject": "Votre essai gratuit se termine dans {days} jours",
    "heading": "Fin de l'essai gratuit",
    "body1": "Votre essai gratuit {plan} se termine le <strong style=\"color:#fff;\">{date}</strong>, et le premier paiement sera prélevé le même jour.",
    "body2": "Aucune action n'est requise si vous souhaitez continuer. Sinon, vous pouvez résilier à tout moment avant cette date depuis votre page d'abonnement.",
    "note": "La Pull-Letter est émise après confirmation du premier paiement, et les demandes sont limitées à 1 par mois.",
    "cta": "GÉRER L'ABONNEMENT"
  },
  "es": {
    "subject": "Tu prueba gratuita termina en {days} días",
    "heading": "Tu prueba gratuita está por terminar",
    "body1": "Tu prueba gratuita {plan} termina el <strong style=\"color:#fff;\">{date}</strong> y el primer cobro se realizará ese mismo día.",
    "body2": "No necesitas hacer nada si deseas continuar. Si prefieres no hacerlo, puedes cancelar en cualquier momento antes de esa fecha desde tu página de suscripción.",
    "note": "La Pull-Letter se emite tras confirmarse el primer pago, y las solicitudes están limitadas a 1 al mes.",
    "cta": "GESTIONAR SUSCRIPCIÓN"
  },
  "ja": {
    "subject": "無料トライアルが{days}日後に終了します",
    "heading": "無料トライアル終了のお知らせ",
    "body1": "{plan}の無料トライアルは<strong style=\"color:#fff;\">{date}</strong>に終了し、同日に初回のお支払いが行われます。",
    "body2": "継続をご希望の場合、お手続きは不要です。ご希望でない場合は、終了日までにサブスクリプションページからいつでも解約いただけます。",
    "note": "Pull-Letterは初回のお支払い確認後に発行され、リクエストは月1件までです。",
    "cta": "サブスクリプション管理"
  },
  "zh": {
    "subject": "您的免费试用将在 {days} 天后结束",
    "heading": "免费试用即将结束",
    "body1": "您的 {plan} 免费试用将于 <strong style=\"color:#fff;\">{date}</strong> 结束，并于当天进行首次扣款。",
    "body2": "如需继续，无需任何操作。如不希望继续，可在结束日前随时在订阅页面取消。",
    "note": "Pull-Letter 在首次付款确认后发放，申请每月限 1 次。",
    "cta": "管理订阅"
  },
  "ru": {
    "subject": "Бесплатный период заканчивается через {days} дн.",
    "heading": "Бесплатный период скоро закончится",
    "body1": "Ваш бесплатный период {plan} заканчивается <strong style=\"color:#fff;\">{date}</strong>, и в этот же день будет списан первый платёж.",
    "body2": "Если вы хотите продолжить, ничего делать не нужно. Если нет — вы можете отменить подписку в любой момент до этой даты на странице подписки.",
    "note": "Pull-Letter выдаётся после подтверждения первого платежа, заявки — не более 1 в месяц.",
    "cta": "УПРАВЛЕНИЕ ПОДПИСКОЙ"
  },
  "de": {
    "subject": "Deine kostenlose Testphase endet in {days} Tagen",
    "heading": "Kostenlose Testphase endet bald",
    "body1": "Deine kostenlose {plan}-Testphase endet am <strong style=\"color:#fff;\">{date}</strong>, und am selben Tag wird die erste Zahlung eingezogen.",
    "body2": "Wenn du fortfahren möchtest, ist nichts zu tun. Andernfalls kannst du jederzeit vor diesem Datum auf deiner Abo-Seite kündigen.",
    "note": "Die Pull-Letter wird nach Bestätigung der ersten Zahlung ausgestellt, Anfragen sind auf 1 pro Monat begrenzt.",
    "cta": "ABO VERWALTEN"
  }
};

const PULLLETTER_ISSUED_I18N = {
  ko: { subject: 'Pull-Letter가 발급되었습니다', heading: 'Pull-Letter 발급 완료', body: '요청하신 Pull-Letter가 발급되었습니다. 마이페이지에서 PDF를 다운로드하실 수 있습니다.', cta: 'PDF 다운로드' },
  en: { subject: 'Your Pull-Letter Has Been Issued', heading: 'Pull-Letter Issued', body: 'Your pull-letter has been issued. You can download the PDF from your My Page.', cta: 'DOWNLOAD PDF' },
  it: { subject: 'La tua Pull-Letter è stata emessa', heading: 'Pull-Letter emessa', body: 'La tua pull-letter è stata emessa. Puoi scaricare il PDF dalla tua My Page.', cta: 'SCARICA PDF' },
  fr: { subject: 'Votre Pull-Letter a été émise', heading: 'Pull-Letter émise', body: 'Votre pull-letter a été émise. Vous pouvez télécharger le PDF depuis votre My Page.', cta: 'TÉLÉCHARGER LE PDF' },
  es: { subject: 'Tu Pull-Letter ha sido emitida', heading: 'Pull-Letter emitida', body: 'Tu pull-letter ha sido emitida. Puedes descargar el PDF desde tu My Page.', cta: 'DESCARGAR PDF' },
  ja: { subject: 'Pull-Letterが発行されました', heading: 'Pull-Letter 発行完了', body: 'Pull-Letterが発行されました。マイページからPDFをダウンロードできます。', cta: 'PDFをダウンロード' },
  zh: { subject: '您的 Pull-Letter 已签发', heading: 'Pull-Letter 已签发', body: '您的 pull-letter 已签发。您可以在“我的页面”下载 PDF。', cta: '下载 PDF' },
  ru: { subject: 'Ваш Pull-Letter выписан', heading: 'Pull-Letter выписан', body: 'Ваш pull-letter выписан. Вы можете скачать PDF в личном кабинете (My Page).', cta: 'СКАЧАТЬ PDF' },
  de: { subject: 'Ihre Pull-Letter wurde ausgestellt', heading: 'Pull-Letter ausgestellt', body: 'Ihre Pull-Letter wurde ausgestellt. Sie können das PDF in Ihrer My Page herunterladen.', cta: 'PDF HERUNTERLADEN' },
};

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
        <div style="margin-top:28px;padding:16px;border:1px solid #3a3223;">
          <span style="color:#c9a86a;font-size:10px;text-transform:uppercase;letter-spacing:2px;">For creative teams</span><br>
          <span style="color:#ccc;font-size:13px;line-height:1.7;">Need garment loans for your next shoot? Premium members can request one official PAP Pull-Letter per month and browse the full editorial archive.</span><br>
          <a href="${FRONTEND_URL}/subscribe?utm_source=submission_received_email&utm_medium=email" style="display:inline-block;margin-top:10px;color:#fff;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:underline;">EXPLORE PREMIUM →</a>
        </div>
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
  // QA #189 — pure notification email.
  // Previous versions embedded the approval payment block (Day/Month +
  // payment links) and a rejection courtesy block directly in the
  // email body. Editorial direction (May 2026): keep the mail purely
  // as a notification — the actual verdict, editor notes, payment
  // options, and resubmit flow all live on the site at
  // /submission.html#mySubsSection. This keeps the email short, the
  // same shape for every status, and avoids leaking sensitive
  // commercial details (payment URLs) into recipients' inboxes.
  //
  // `opts` parameter kept in the signature for backward compat with
  // callers that still pass approvalDay/Month — values are now ignored
  // and the day/month info is surfaced only on MY SUBMISSIONS.
  submissionReviewComplete(user, submission, lang, status, _opts) {
    const L = SUBMISSION_REVIEW_I18N[lang] || SUBMISSION_REVIEW_I18N.en;
    const safeName = user && user.name ? user.name : (L.greetingFallback);
    const safeTitle = submission && submission.title ? submission.title : '—';
    const ctaUrl = `${FRONTEND_URL}/submission.html#mySubsSection`;

    // 유료/브랜디드 승인 시 게재료 결제요청 안내(금액만 표기, 결제 URL 은 넣지 않고
    // MY SUBMISSIONS 로 유도 — 상업 링크를 수신함에 넣지 않는 기존 설계 유지).
    // 금액은 서버 단일 소스(submissionPayment.feeForType)로 산출한 euro-cents 를
    // review.js 가 _opts.feeCents 로 주입한다. 그 외 상태/무료는 블록 미표시.
    const _feeCents = _opts && Number(_opts.feeCents) > 0 ? Number(_opts.feeCents) : 0;
    const _payBlock = (status === 'approved' && _feeCents > 0)
      ? `<div style="margin:20px 0;padding:16px 18px;background:#1a1a1a;border-left:3px solid #c9a86a;">
           <span style="color:#c9a86a;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">${L.payTitle}</span><br>
           <span style="color:#ddd;font-size:14px;line-height:1.6;">${L.payBody.replace('{amt}', `<strong style="color:#fff;">€${Math.round(_feeCents / 100)}</strong>`)}</span>
         </div>`
      : '';

    // 승인(approved)일 때만 축하 톤 — 제목·헤딩·첫 문단을 승인 전용 문구로 교체하고
    // 유료/브랜디드면 "유료 게재가 승인되었습니다" 로 표기. 보완요청(revision)은
    // 결과를 수신함에 드러내지 않는 기존 설계(QA #165)를 유지해 중립 문구를 쓴다.
    //
    // 2026-08-03 — 거절(rejected)도 QA #165 를 그대로 따른다. 도메니코의 거절
    // 안내 편지는 메일이 아니라 MY SUBMISSIONS(admin_notes)에만 노출한다.
    // 즉 이 템플릿은 어떤 상태에서도 심사 사유·거절 문구를 본문에 싣지 않는다.
    const _isApproved = status === 'approved';
    const _titleStrong = `<strong style="color:#fff;">"${safeTitle}"</strong>`;
    const _subject = (_isApproved && L.apSubject ? L.apSubject : L.subject).replace('{title}', safeTitle);
    const _heading = _isApproved && L.apHeading ? L.apHeading : L.heading;
    let _firstPara;
    if (_isApproved && L.apCongrats) {
      const _congrats = (_feeCents > 0 && L.apCongratsPaid) ? L.apCongratsPaid : L.apCongrats;
      _firstPara = _congrats.replace('{title}', _titleStrong);
    } else {
      _firstPara = L.body1.replace('{title}', _titleStrong);
    }

    return {
      subject: _subject,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${_heading}</h2>
        <p>${L.greet.replace('{name}', safeName)}</p>
        <p>${_firstPara}</p>
        <p>${L.body2}</p>
        ${_payBlock}
        <a href="${ctaUrl}" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">${L.cta}</a>
        <p style="font-size:12px;color:#888;margin-top:24px;">${L.footer}</p>
      `, lang),
    };
  },

  // Legacy aliases kept so callers that still hardcode the per-status
  // template names keep working. They all funnel into the single
  // submissionReviewComplete entry point above, passing their status so
  // the approved-only celebratory copy lights up for 'approved' only.
  // 어느 별칭으로 들어와도 거절 문구는 메일에 실리지 않는다(QA #165 유지).
  submissionApproved(user, submission, _note, lang, opts) {
    return templates.submissionReviewComplete(user, submission, lang, 'approved', opts);
  },
  submissionRejected(user, submission, _note, lang, opts) {
    return templates.submissionReviewComplete(user, submission, lang, 'rejected', opts);
  },
  submissionRevision(user, submission, _note, lang, opts) {
    return templates.submissionReviewComplete(user, submission, lang, 'revision', opts);
  },


  // 5. Pull-letter request received
  pullletterReceived(user, lang) {
    const L = (PULLLETTER_I18N[lang] || PULLLETTER_I18N.en).received;
    const greet = emailUiStrings(lang).greeting.replace('{name}', (user && user.name) || 'there');
    return {
      subject: L.subject,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${L.heading}</h2>
        <p>${greet}</p>
        <p>${L.body1}</p>
        <table style="margin:20px 0;width:100%;">
          <tr><td style="padding:12px 16px;background:#1a1a1a;border-left:3px solid #fff;">
            <span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">${L.statusLabel}</span><br>
            <span style="color:#fff;font-size:14px;font-weight:600;">${L.statusValue}</span>
          </td></tr>
        </table>
        <p>${L.body2}</p>
        <!-- 2026-08-03 — 풀레터 검토 소요기간(영업일 7일) 명시. 그 전에는 웹·메일
             어디에도 기간 안내가 없어 신청자가 무한정 기다리는 구조였다. -->
        <p style="font-size:13px;color:#999;">${L.eta || ''}</p>
      `, lang),
    };
  },

  // 6. Pull-letter accepted
  pullletterAccepted(user, note, lang) {
    const L = (PULLLETTER_I18N[lang] || PULLLETTER_I18N.en).accepted;
    const greet = emailUiStrings(lang).greeting.replace('{name}', (user && user.name) || 'there');
    return {
      subject: L.subject,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${L.heading}</h2>
        <p>${greet}</p>
        <p>${L.body1}</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #4CAF50;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">${L.detailsLabel}</span><br><span style="color:#ccc;font-size:14px;">${note}</span></div>` : ''}
        <a href="${FRONTEND_URL}/mypage#mp-pullletters" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">${L.cta}</a>
      `, lang),
    };
  },

  // 7. Pull-letter rejected
  pullletterRejected(user, note, lang) {
    const L = (PULLLETTER_I18N[lang] || PULLLETTER_I18N.en).rejected;
    const greet = emailUiStrings(lang).greeting.replace('{name}', (user && user.name) || 'there');
    return {
      subject: L.subject,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${L.heading}</h2>
        <p>${greet}</p>
        <p>${L.body1}</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #888;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">${L.reasonLabel}</span><br><span style="color:#ccc;font-size:14px;">${note}</span></div>` : ''}
        <p>${L.body2}</p>
      `, lang),
    };
  },

  // 7b. Pull-letter issued (PDF ready to download) — B-3
  pullletterIssued(user, note, lang) {
    var L = PULLLETTER_ISSUED_I18N[lang] || PULLLETTER_ISSUED_I18N.en;
    var greet = emailUiStrings(lang).greeting.replace('{name}', (user && user.name) || 'there');
    var detailsLabel = (PULLLETTER_I18N[lang] || PULLLETTER_I18N.en).accepted.detailsLabel;
    var noteHtml = note ? ('<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #4CAF50;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">' + detailsLabel + '</span><br><span style="color:#ccc;font-size:14px;">' + note + '</span></div>') : '';
    var html = '<h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">' + L.heading + '</h2>'
      + '<p>' + greet + '</p>'
      + '<p>' + L.body + '</p>'
      + noteHtml
      + '<a href="' + FRONTEND_URL + '/mypage#mp-pullletters" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">' + L.cta + '</a>';
    return { subject: L.subject, html: wrapHtml(html, lang) };
  },

  // 7c. Pull-letter revision requested (2026-08-25 도메니코 — 무드보드 피드백 왕복)
  pullletterRevision(user, note, lang) {
    var isKo = lang === 'ko';
    var greet = emailUiStrings(lang).greeting.replace('{name}', (user && user.name) || 'there');
    var subject = isKo ? '[PAP Magazine] 풀레터 무드보드 수정 요청' : '[PAP Magazine] Pull-Letter: revision requested';
    var heading = isKo ? '무드보드 수정 요청' : 'Revision requested';
    var body1 = isKo
      ? '보내주신 풀레터 신청을 검토했습니다. 발급 전에 무드보드에 아래 수정이 필요합니다.'
      : 'We have reviewed your Pull-Letter request. Before we can issue the letter, the mood board needs the following revisions.';
    var noteLabel = isKo ? '에디터 피드백' : 'Editor feedback';
    var body2 = isKo
      ? '마이페이지에서 수정한 무드보드를 다시 올려주시면 재검토 후 발급해 드립니다.'
      : 'Please upload your revised mood board from My Page — we will review it again and issue the letter once it is ready.';
    var cta = isKo ? '수정본 올리기' : 'Upload revision';
    var noteHtml = note ? ('<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #E6B800;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">' + noteLabel + '</span><br><span style="color:#ccc;font-size:14px;white-space:pre-line;">' + note + '</span></div>') : '';
    var html = '<h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">' + heading + '</h2>'
      + '<p>' + greet + '</p>'
      + '<p>' + body1 + '</p>'
      + noteHtml
      + '<p>' + body2 + '</p>'
      + '<a href="' + FRONTEND_URL + '/mypage#mp-pullletters" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">' + cta + '</a>';
    return { subject: subject, html: wrapHtml(html, lang) };
  },

  // 8. Subscription confirmation
  subscriptionConfirmed(user, plan, lang) {
    const planLabels = {
      standard_monthly: 'Standard (Monthly)',
      standard_yearly: 'Standard (Yearly)',
      premium_monthly: 'Premium (Monthly)',
      premium_yearly: 'Premium (Yearly)',
    };
    const L = SUBSCRIPTION_I18N[lang] || SUBSCRIPTION_I18N.en;
    const greet = emailUiStrings(lang).greeting.replace('{name}', (user && user.name) || 'there');
    const planHtml = `<strong style="color:#fff;">${planLabels[plan] || plan}</strong>`;
    return {
      subject: L.subject,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${L.heading}</h2>
        <p>${greet}</p>
        <p>${L.body1.replace('{plan}', planHtml)}</p>
        <p>${L.body2}</p>
        <a href="${FRONTEND_URL}/subscribe" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">${L.cta}</a>
      `, lang),
    };
  },

  // 2026-08-03 시윤 4단계 — 무료체험 종료 3일 전 안내 메일.
  // 목적: 회원이 "모르는 사이에 결제됐다"고 느끼지 않게 하는 것 + 풀레터
  // 발급 조건(첫 결제 후)과 월 1건 상한을 결제 전에 한 번 더 알리는 것.
  // 호출: api/cron/trial-ending-reminder.js
  trialEndingSoon(user, opts) {
    const o = opts || {};
    const lang = (o.lang) || (user && user.language) || 'en';
    const L = TRIAL_ENDING_I18N[lang] || TRIAL_ENDING_I18N.en;
    const planLabels = {
      standard_monthly: 'Standard (Monthly)',
      standard_yearly: 'Standard (Yearly)',
      premium_monthly: 'Premium (Monthly)',
      premium_yearly: 'Premium (Yearly)',
    };
    const greet = emailUiStrings(lang).greeting.replace('{name}', (user && user.name) || 'there');
    const planLabel = planLabels[o.plan] || o.plan || 'PAP';
    const days = String(o.days == null ? 3 : o.days);
    const date = o.chargeDateKst || '-';
    return {
      subject: L.subject.replace('{days}', days),
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${L.heading}</h2>
        <p>${greet}</p>
        <p>${L.body1.replace('{plan}', planLabel).replace('{date}', date)}</p>
        <p>${L.body2}</p>
        <p style="color:rgba(255,255,255,.55);font-size:13px;">${L.note}</p>
        <a href="${FRONTEND_URL}/subscribe" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">${L.cta}</a>
      `, lang),
    };
  },

  // ── Marketing newsletter templates ────────────────────────────────
  // Used by /api/cron/send-due-campaigns. Each takes the campaign row
  // (with payload), the recipient profile, and an unsubscribe token so
  // every email body carries a working one-click opt-out link.
  // Marketing wrapper (different from wrapHtml): light "footer" with
  // sender info + unsubscribe link as required by 정보통신망법 §50.

  weeklyEditorial: (campaign, user, unsubToken) => {
    const lang = (user && user.language) || 'en';
    const L = emailUiStrings(lang);
    const eds = (campaign.payload && campaign.payload.editorials) || [];
    const cards = eds.map(ed => `
      <tr><td style="padding-bottom:24px;">
        <a href="${withMailUtm(`${FRONTEND_URL}/editorial/${encodeURIComponent(ed.slug || ed.id)}`)}" style="text-decoration:none;color:inherit;display:block;">
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
        preheader: campaign.preheader || L.editorialPreheader,
        body: `
          <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">THIS WEEK&apos;S EDITORIALS</div>
          <h1 style="font-size:26px;color:#fff;margin:0 0 8px;letter-spacing:.5px;line-height:1.25;">${escapeHtml(campaign.hero_headline || L.editorialTitle)}</h1>
          <p style="color:#999;font-size:13px;line-height:1.7;margin:0 0 24px;">${escapeHtml(campaign.hero_body || '')}</p>
          <div style="font-size:12px;color:#aaa;margin-bottom:24px;">${L.greeting.replace('{name}', `<strong style="color:#fff;">${escapeHtml(greeting)}</strong>`)}</div>
          <table width="100%" cellpadding="0" cellspacing="0">${cards}</table>
          <a href="${withMailUtm(FRONTEND_URL + '/')}" style="display:inline-block;background:#fff;color:#000;padding:14px 36px;font-size:11px;font-weight:700;letter-spacing:2px;text-decoration:none;margin-top:8px;">VIEW MORE ON PAP</a>
        `,
        unsubUrl: `${FRONTEND_URL}/api/auth/unsubscribe?token=${unsubToken}`,
        lang,
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
    // Fixed chrome strings (legal footer, unsubscribe, selector label)
    // follow the SAME locale as the article content, so the whole email
    // reads in one language end-to-end.
    const L = emailUiStrings(lang);
    // In-email language selector: one link per site locale, hitting
    // /api/email/language which flips profiles.email_language via the
    // same per-recipient token as the unsubscribe link (not consumed).
    // The recipient's current language renders bold + underlined.
    const langBar = SUPPORTED_LANGS.map(l => l === lang
      ? `<span style="color:#1a1a1a;font-weight:700;text-decoration:underline;white-space:nowrap;">${LANG_LABELS[l]}</span>`
      : `<a href="${FRONTEND_URL}/api/email/language?token=${unsubToken}&amp;lang=${l}" style="color:#999;text-decoration:none;white-space:nowrap;">${LANG_LABELS[l]}</a>`
    ).join(' &nbsp;·&nbsp; ');
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
    <!-- 2026-08-08 — 도달점 CTA. 이 다이제스트에는 그동안 PAP 로 가는 링크가
         하나도 없었다(뉴스 카드는 텍스트, 링크는 수신거부·언어선택뿐).
         '재방문 엔진'이 아무 데도 안 보내고 있었던 것 — 성장 헌법 1·3조 위반.
         웹은 utm=newsletter, IG 는 ig-out?src=newsletter 로 둘 다 계측된다. -->
    <tr><td align="center" style="padding:28px 28px 4px;">
      <a href="${withMailUtm(FRONTEND_URL + '/')}" style="display:inline-block;background:#6b1a1a;color:#ffffff;padding:13px 32px;font-size:11px;font-weight:700;letter-spacing:2px;text-decoration:none;">VIEW PAP MAGAZINE</a>
    </td></tr>
    <tr><td align="center" style="padding:6px 28px 2px;font-size:11px;">
      <a href="${IG_FOLLOW_MAIL}" style="color:#6b1a1a;text-decoration:underline;font-weight:600;letter-spacing:1px;">FOLLOW @PAP_MAGAZINE</a>
    </td></tr>
    <tr><td style="padding:18px 28px 0;"><hr style="border:none;border-top:1px solid #eee;"></td></tr>
    <!-- Language selector: lets the recipient re-pick their newsletter
         locale without logging in. Current locale is bold/underlined. -->
    <tr><td align="center" style="padding:16px 28px 0;font-size:11px;color:#999;line-height:2;">
      <div style="font-size:9px;letter-spacing:2px;color:#bbb;text-transform:uppercase;margin-bottom:4px;">${escapeHtml(L.languageLabel)}</div>
      ${langBar}
    </td></tr>
    <!-- Legal: unsubscribe + sender info, required for marketing email.
         Localized to the recipient's locale (emailLocale.js). -->
    <tr><td style="padding:18px 28px 0;font-size:11px;color:#888;line-height:1.6;">
      ${L.consentNotice.replace(/<strong>/g, '<strong style="color:#555;">')}
      &nbsp;·&nbsp;
      <a href="${FRONTEND_URL}/api/auth/unsubscribe?token=${unsubToken}" style="color:#6b1a1a;text-decoration:underline;">${escapeHtml(L.unsubscribe)}</a>
      &nbsp;·&nbsp;
      <a href="${FRONTEND_URL}/mypage#mp-preferences" style="color:#6b1a1a;text-decoration:underline;">${escapeHtml(L.managePrefs)}</a>
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
  // ── creator-pullletter — 풀레터 소개 캠페인 (2026-08-26) ─────────
  // 유료 구독자 늘리기 1탄-②: 이미 서브미션을 제출한 무료 크리에이터
  // (payload.audience='submitters_free', 발송기 측에서 세그먼트)에게
  // 풀레터 제도를 소개한다. 약속은 subscribe 페이지와 동일한 실제
  // 혜택만: Pull-Letter 요청 월 1건 + 전체 에디토리얼 아카이브.
  //
  // 디자인은 웹사이트(pap-styles.css)를 그대로 따른다 (2026-08-26 지시):
  //   · 검정 헤더 + 흰 로고(pap-logo.png), 페이지 배경 #f5f5f5(--bg)
  //   · 브랜드 레드 #891717(--pap-red), 그레이 #e5e5e5/#999/#555
  //   · 헤딩 Montserrat 800 대문자 자간, 본문 Inter (메일 클라이언트가
  //     웹폰트를 막으면 Helvetica 볼드로 폴백해도 같은 인상 유지)
  //   · 혜택 박스는 subscribe 페이지의 검정 플랜카드 + 흰 CTA 문법
  // 수신거부·언어선택·법적 고지는 weeklyNews 와 동일 규격.
  creatorPullletter: (campaign, user, unsubToken) => {
    const lang = (user && user.language) || 'en';
    const L = emailUiStrings(lang);
    const langBar = SUPPORTED_LANGS.map(l => l === lang
      ? `<span style="color:#111;font-weight:700;text-decoration:underline;white-space:nowrap;">${LANG_LABELS[l]}</span>`
      : `<a href="${FRONTEND_URL}/api/email/language?token=${unsubToken}&amp;lang=${l}" style="color:#999;text-decoration:none;white-space:nowrap;">${LANG_LABELS[l]}</a>`
    ).join(' &nbsp;·&nbsp; ');

    const COPY = {
      ko: {
        subject: 'PAP 공식 풀레터, 크리에이터를 위한 샘플 대여 공문',
        preheader: '제출해 주신 작업 잘 봤습니다. PAP 공식 풀레터 제도를 소개합니다.',
        kicker: 'FOR CREATIVE TEAMS',
        headline: 'PAP 공식 Pull Letter를 소개합니다',
        p1: 'PAP Magazine에 작업을 제출해 주신 크리에이터분께 안내드립니다. 풀레터(Pull Letter)는 매거진 명의의 공식 공문으로, 브랜드·쇼룸 샘플 대여는 물론 로케이션 섭외 등 촬영과 관련한 협조를 요청하는 자리에서 PAP와 촬영을 진행한다는 사실을 공식적으로 증명하는 문서입니다.',
        p2: '발급은 심사제입니다. 제출하신 무드보드의 방향과 포토그래퍼의 포트폴리오가 PAP의 에디토리얼 미감과 맞는지 에디토리얼 팀이 검토하며, 승인된 요청에 한해 포토그래퍼·스타일리스트 이름과 발급일이 명시된 PDF 공문이 발급됩니다.',
        stepsTitle: 'HOW IT WORKS',
        steps: ['마이페이지에서 무드보드와 팀 정보 제출', '에디토리얼 팀 심사 · 피드백 (무드보드와 포트폴리오가 PAP의 방향과 맞아야 승인됩니다)', '승인 시 PDF 공문 발급 (발급일로부터 2개월 유효)'],
        cta: '풀레터 요청하기',
        footnote: '풀레터 요청은 프리미엄 멤버십에 포함되어 있으며 월 1건 요청할 수 있습니다.',
        footnoteLink: '멤버십 안내',
      },
      en: {
        subject: 'The Official PAP Pull Letter for Creative Teams',
        preheader: 'You have submitted work to PAP. Introducing the official PAP Pull Letter.',
        kicker: 'FOR CREATIVE TEAMS',
        headline: 'The Official PAP Pull Letter',
        p1: 'You are receiving this because you have submitted work to PAP Magazine. A Pull Letter is an official letter issued in the magazine’s name: formal proof that you are shooting with PAP, used when pulling samples from brands and showrooms, negotiating locations, and requesting production support of any kind.',
        p2: 'Issuance is selective. The editorial team reviews whether your moodboard and the photographer’s portfolio align with PAP’s editorial aesthetic; only approved requests receive a PDF letter carrying the photographer and stylist names and the date of issue.',
        stepsTitle: 'HOW IT WORKS',
        steps: ['Submit your moodboard and team details from My Page', 'Editorial review and feedback (the moodboard and portfolio must align with PAP’s direction)', 'If approved, a PDF letter is issued, valid for two months from the date of issue'],
        cta: 'Request a Pull Letter',
        footnote: 'Pull Letter requests are part of the Premium membership, with one request per month.',
        footnoteLink: 'About membership',
      },
    };
    const C = COPY[lang] || COPY.en;
    // 제목·프리헤더는 수신자 언어를 따른다. DB의 campaign.subject 는
    // NOT NULL 제약용 관리 라벨일 뿐 — 그걸 그대로 쓰면 영어 수신자도
    // 한국어 제목을 받는다. 언어별 오버라이드가 필요하면
    // payload.i18n[lang].subject 로 넣는다 (weeklyNews 관례와 동일).
    const ov = ((campaign && campaign.payload && campaign.payload.i18n) || {})[lang] || {};
    const subject = ov.subject || C.subject;
    const preheader = ov.preheader || C.preheader;
    // 주 CTA는 '판매 페이지'가 아니라 실제로 풀레터를 신청하는 곳
    // (마이페이지 풀레터 섹션)으로 보낸다 — 2026-08-26 도메니코 지시:
    // 가입 유도가 적나라하게 드러나지 않게. 무료 회원은 신청 과정에서
    // 프리미엄 요건(서버측 게이트)을 자연스럽게 만난다. 멤버십 링크는
    // 하단 각주로만 두되, 낚시가 되지 않도록 각주에 요건을 명시한다.
    const ctaUrl = `${FRONTEND_URL}/mypage?utm_source=creator_pullletter_campaign&utm_medium=email#mp-pullletters`;
    const membershipUrl = `${FRONTEND_URL}/subscribe?utm_source=creator_pullletter_campaign&utm_medium=email`;
    const MONT = "'Montserrat','Inter',Helvetica,Arial,sans-serif";

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PAP Pull Letter</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;"><tr><td align="center" style="padding:0 0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:'Inter',-apple-system,Helvetica,Arial,sans-serif;background:#ffffff;">
    <tr><td align="center" style="background-color:#000000;padding:26px 20px;"><a href="${FRONTEND_URL}/?utm_source=creator_pullletter_campaign&utm_medium=email" style="text-decoration:none;"><img src="${FRONTEND_URL}/pap-logo.png" width="72" style="display:block;" alt="PAP MAGAZINE"></a></td></tr>
    <tr><td align="center" style="padding:44px 32px 0;font-family:${MONT};font-size:10px;font-weight:800;color:#891717;letter-spacing:4px;text-transform:uppercase;">${escapeHtml(C.kicker)}</td></tr>
    <tr><td align="center" style="padding:14px 32px 0;font-family:${MONT};font-size:22px;font-weight:800;color:#111;line-height:1.4;letter-spacing:1px;text-transform:uppercase;">${escapeHtml(C.headline)}</td></tr>
    <tr><td align="center" style="padding:18px 32px 0;"><div style="width:36px;height:2px;background:#891717;font-size:0;line-height:0;">&nbsp;</div></td></tr>
    <tr><td style="padding:26px 40px 0;font-size:14px;color:#555;line-height:1.85;">${escapeHtml(C.p1)}</td></tr>
    <tr><td style="padding:14px 40px 0;font-size:14px;color:#555;line-height:1.85;">${escapeHtml(C.p2)}</td></tr>
    <tr><td style="padding:30px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e5e5;">
        <tr><td colspan="2" style="padding:20px 0 4px;font-family:${MONT};font-size:10px;font-weight:800;color:#999;letter-spacing:3px;text-transform:uppercase;">${escapeHtml(C.stepsTitle)}</td></tr>
        ${C.steps.map((st, i) => `
        <tr><td width="30" valign="top" style="padding:10px 0 0;font-family:${MONT};font-weight:800;color:#891717;font-size:12px;letter-spacing:1px;line-height:1.9;">0${i + 1}</td><td valign="top" style="padding:10px 0 0;font-size:13.5px;color:#555;line-height:1.7;">${escapeHtml(st)}</td></tr>`).join('')}
      </table>
    </td></tr>
    <tr><td align="center" style="padding:30px 40px 0;">
      <a href="${ctaUrl}" style="display:inline-block;background:#000000;color:#ffffff;padding:14px 40px;font-family:${MONT};font-size:11px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;text-decoration:none;border:1.5px solid #000000;">${escapeHtml(C.cta)}</a>
    </td></tr>
    <tr><td align="center" style="padding:16px 40px 0;font-size:11.5px;color:#999;line-height:1.7;">${escapeHtml(C.footnote)} <a href="${membershipUrl}" style="color:#999;text-decoration:underline;">${escapeHtml(C.footnoteLink)}</a></td></tr>
    <tr><td style="padding:32px 40px 0;"><hr style="border:none;border-top:1px solid #e5e5e5;"></td></tr>
    <tr><td align="center" style="padding:18px 32px 0;font-size:11px;color:#999;line-height:2;">
      <div style="font-family:${MONT};font-size:9px;font-weight:700;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:4px;">${escapeHtml(L.languageLabel)}</div>
      ${langBar}
    </td></tr>
    <tr><td style="padding:18px 40px 28px;font-size:11px;color:#777;line-height:1.6;">
      ${L.consentNotice.replace(/<strong>/g, '<strong style="color:#555;">')}
      &nbsp;·&nbsp;
      <a href="${FRONTEND_URL}/api/auth/unsubscribe?token=${unsubToken}" style="color:#891717;text-decoration:underline;">${escapeHtml(L.unsubscribe)}</a>
      &nbsp;·&nbsp;
      <a href="${FRONTEND_URL}/mypage#mp-preferences" style="color:#891717;text-decoration:underline;">${escapeHtml(L.managePrefs)}</a>
    </td></tr>
    <tr><td align="center" style="background-color:#000000;padding:30px 20px;">
      <div style="font-family:${MONT};font-size:11px;font-weight:800;color:#ffffff;letter-spacing:5px;">P A P &nbsp; M A G A Z I N E</div>
      <div style="font-size:10px;color:#999;margin-top:8px;letter-spacing:1px;">ART &middot; FASHION &middot; BEAUTY &middot; CULTURE</div>
      <div style="font-size:11px;color:#777;margin-top:8px;">pap-magazine.com | @pap_magazine</div>
    </td></tr>
  </table>
  </td></tr></table>
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
function wrapMarketing({ preheader, body, unsubUrl, lang }) {
  // Footer chrome follows the recipient's locale so the email reads in
  // ONE language end-to-end (article content + legal strings alike).
  const L = emailUiStrings(lang || 'en');
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
            ${L.consentNotice.replace(/<strong>/g, '<strong style="color:#aaa;">')}
          </p>
          <p style="margin:0 0 14px;">
            <a href="${unsubUrl}" style="color:#bbb;text-decoration:underline;">${escapeHtml(L.unsubscribe)}</a>
            &nbsp;·&nbsp;
            <a href="${FRONTEND_URL}/mypage#mp-preferences" style="color:#bbb;text-decoration:underline;">${escapeHtml(L.managePrefs)}</a>
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
    /* 2026-08-07 — 사유를 명시한다. 예전엔 { skipped:true } 만 돌려줘서
       호출부가 email_log 에 error='unknown' 으로 적었다. 그러면 나중에
       "왜 안 갔지" 를 로그만 보고는 절대 알 수 없다. */
    console.error('[EMAIL] SMTP 미설정 — 발송 건너뜀:', to);
    return { skipped: true, error: 'SMTP 미설정 (SMTP_USER/SMTP_PASS)' };
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

module.exports = { sendEmail, templates, DEFAULT_REJECTION_NOTE, REJECTION_LETTER_BODY };
