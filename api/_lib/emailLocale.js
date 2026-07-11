/**
 * PAP Magazine — newsletter locale resolution (server side)
 *
 * Mirrors frontend/pap-geo-lang.js COUNTRY_LANG so a member's email
 * language is derived the same way the site language is. Keep the two
 * maps in sync when adding locales.
 *
 * resolveEmailLang(profile) fallback chain:
 *   1) profile.email_language   — explicit newsletter preference (mypage
 *      dropdown or the in-email language selector)
 *   2) profile.language         — site UI language (synced by pap-i18n.js)
 *   3) COUNTRY_LANG[country]    — geo-derived guess from profiles.country
 *   4) 'en'                     — safe default
 */

const SUPPORTED_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

// Native-script labels for the in-email language selector.
const LANG_LABELS = {
  ko: '한국어',
  en: 'English',
  it: 'Italiano',
  fr: 'Français',
  es: 'Español',
  ja: '日本語',
  zh: '中文',
  ru: 'Русский',
  de: 'Deutsch',
};

// Country → language mapping (mirror of frontend/pap-geo-lang.js).
const COUNTRY_LANG = {
  KR: 'ko',
  JP: 'ja',
  CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh', SG: 'zh',
  IT: 'it', SM: 'it', VA: 'it',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
  SN: 'fr', CI: 'fr', CM: 'fr', DZ: 'fr', MA: 'fr', TN: 'fr',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', PE: 'es', VE: 'es',
  CL: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es',
  HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es',
  UY: 'es', PR: 'es',
  RU: 'ru', BY: 'ru', KZ: 'ru', KG: 'ru',
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  // default for US/UK/CA/AU/NZ/IE/NL/others → 'en'
};

// Fixed UI strings inside marketing emails (legal footer, unsubscribe
// link, language selector heading, greeting). The ARTICLE content is
// localized via campaign.payload.i18n — these are the chrome around it,
// which must follow the same locale so the whole email reads in ONE
// language. `<strong>` tags are kept bare here; templates inject their
// own inline color style via replace().
const EMAIL_UI_I18N = {
  ko: {
    consentNotice: '본 메일은 PAP Magazine에 가입하시고 <strong>이메일 수신에 동의</strong>하신 회원에게 발송됩니다.',
    unsubscribe: '수신 거부',
    managePrefs: '알림 설정 변경',
    languageLabel: '언어 설정',
    igFollowTagline: '매일 업데이트되는 에디토리얼과 패션 뉴스,<br>인스타그램에서 가장 먼저 만나보세요.',
    greeting: '안녕하세요, {name}님.',
    editorialPreheader: '이주의 PAP 에디토리얼',
    editorialTitle: '이주의 에디토리얼',
  },
  en: {
    consentNotice: 'This email is sent to PAP Magazine members who have <strong>opted in to email updates</strong>.',
    unsubscribe: 'Unsubscribe',
    managePrefs: 'Manage preferences',
    languageLabel: 'Language',
    igFollowTagline: 'New editorials and fashion news, every day —<br>see them first on Instagram.',
    greeting: 'Hello, {name}.',
    editorialPreheader: 'This week\'s PAP editorials',
    editorialTitle: 'Editorials of the Week',
  },
  it: {
    consentNotice: 'Questa email è inviata ai membri di PAP Magazine che hanno <strong>acconsentito a ricevere comunicazioni via email</strong>.',
    unsubscribe: 'Annulla iscrizione',
    managePrefs: 'Gestisci preferenze',
    languageLabel: 'Lingua',
    igFollowTagline: 'Nuovi editoriali e notizie di moda, ogni giorno —<br>guardali prima su Instagram.',
    greeting: 'Ciao, {name}.',
    editorialPreheader: 'Gli editoriali PAP della settimana',
    editorialTitle: 'Editoriali della settimana',
  },
  fr: {
    consentNotice: 'Cet email est envoyé aux membres de PAP Magazine ayant <strong>accepté de recevoir nos emails</strong>.',
    unsubscribe: 'Se désabonner',
    managePrefs: 'Gérer les préférences',
    languageLabel: 'Langue',
    igFollowTagline: 'De nouveaux éditoriaux et de l\'actu mode, chaque jour —<br>à découvrir d\'abord sur Instagram.',
    greeting: 'Bonjour {name},',
    editorialPreheader: 'Les éditoriaux PAP de la semaine',
    editorialTitle: 'Éditoriaux de la semaine',
  },
  es: {
    consentNotice: 'Este correo se envía a los miembros de PAP Magazine que han <strong>aceptado recibir comunicaciones por email</strong>.',
    unsubscribe: 'Cancelar suscripción',
    managePrefs: 'Gestionar preferencias',
    languageLabel: 'Idioma',
    igFollowTagline: 'Nuevos editoriales y noticias de moda, cada día —<br>míralos primero en Instagram.',
    greeting: 'Hola, {name}.',
    editorialPreheader: 'Los editoriales PAP de la semana',
    editorialTitle: 'Editoriales de la semana',
  },
  ja: {
    consentNotice: 'このメールは、PAP Magazineに登録し<strong>メール受信に同意</strong>された会員の方にお送りしています。',
    unsubscribe: '配信停止',
    managePrefs: '通知設定を変更',
    languageLabel: '言語設定',
    igFollowTagline: '毎日更新されるエディトリアルとファッションニュースを、<br>まず Instagram でチェック。',
    greeting: '{name} 様',
    editorialPreheader: '今週のPAPエディトリアル',
    editorialTitle: '今週のエディトリアル',
  },
  zh: {
    consentNotice: '本邮件发送给已注册 PAP Magazine 并<strong>同意接收邮件</strong>的会员。',
    unsubscribe: '退订',
    managePrefs: '管理通知设置',
    languageLabel: '语言设置',
    igFollowTagline: '每日更新的时尚大片与资讯，<br>抢先在 Instagram 上关注。',
    greeting: '{name}，您好。',
    editorialPreheader: '本周 PAP 特辑',
    editorialTitle: '本周特辑',
  },
  ru: {
    consentNotice: 'Это письмо отправлено участникам PAP Magazine, <strong>давшим согласие на получение рассылки</strong>.',
    unsubscribe: 'Отписаться',
    managePrefs: 'Управление настройками',
    languageLabel: 'Язык',
    igFollowTagline: 'Новые эдиториалы и модные новости каждый день —<br>смотрите первыми в Instagram.',
    greeting: 'Здравствуйте, {name}!',
    editorialPreheader: 'Эдиториалы PAP этой недели',
    editorialTitle: 'Эдиториалы недели',
  },
  de: {
    consentNotice: 'Diese E-Mail erhalten Mitglieder von PAP Magazine, die dem <strong>E-Mail-Empfang zugestimmt</strong> haben.',
    unsubscribe: 'Abbestellen',
    managePrefs: 'Einstellungen verwalten',
    languageLabel: 'Sprache',
    igFollowTagline: 'Neue Editorials und Fashion-News, täglich —<br>zuerst auf Instagram entdecken.',
    greeting: 'Hallo {name},',
    editorialPreheader: 'Die PAP-Editorials der Woche',
    editorialTitle: 'Editorials der Woche',
  },
};

function emailUiStrings(lang) {
  return EMAIL_UI_I18N[lang] || EMAIL_UI_I18N.en;
}

function countryToLang(cc) {
  if (!cc || typeof cc !== 'string') return null;
  return COUNTRY_LANG[cc.toUpperCase()] || 'en';
}

function isSupported(lang) {
  return typeof lang === 'string' && SUPPORTED_LANGS.includes(lang);
}

/**
 * @param {object} profile — row with optional email_language, language, country
 * @returns {string} one of SUPPORTED_LANGS, never null
 */
function resolveEmailLang(profile) {
  const p = profile || {};
  if (isSupported(p.email_language)) return p.email_language;
  if (isSupported(p.language)) return p.language;
  const geo = countryToLang(p.country);
  if (isSupported(geo)) return geo;
  return 'en';
}

/**
 * Extract the visitor's country from Vercel/Cloudflare edge headers.
 * Returns a 2-letter uppercase code or null.
 */
function countryFromRequest(req) {
  const raw = (req && req.headers && (
    req.headers['x-vercel-ip-country']
    || req.headers['cf-ipcountry']
    || req.headers['x-country-code']
  )) || '';
  const cc = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

module.exports = {
  SUPPORTED_LANGS,
  LANG_LABELS,
  COUNTRY_LANG,
  EMAIL_UI_I18N,
  emailUiStrings,
  countryToLang,
  resolveEmailLang,
  countryFromRequest,
};
