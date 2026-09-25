'use strict';
/**
 * 풀레터 팀원 알림 (2026-09-25, 도메니코 "풀레터에 이름이 적힌 팀원에게 알림 메일").
 *
 * 실측으로 설계를 바꿨다: 풀레터의 팀원(포토그래퍼·스타일리스트 등)은 이름과 인스타그램 아이디만 있고
 * 이메일이 없다(이메일은 신청자 contact 뿐). 모르는 사람에게 홍보 메일을 보내는 것은 EU·이탈리아
 * 규정(동의 없는 마케팅 메일)에도 걸린다. 그래서 두 길로 나눈다:
 *   1) 팀원의 인스타 아이디가 PAP 회원(마이페이지 인스타 등록)과 같으면 → 그 회원에게 직접 알림
 *      (자기 이름이 PAP 공식 문서에 실렸다는 안내. 개인정보를 본인 아닌 곳에서 받았을 때의 고지 성격)
 *   2) 회원이 아닌 팀원 → 신청자에게 가는 발급 메일에 "팀원에게 알려 주세요" 블록 + 가입 링크(utm)
 *      신청자가 팀원에게 전달한다. 우리가 모르는 주소로는 보내지 않는다.
 */

const TEAM_NOTICE = {
  ko: { subject: '회원님 이름이 PAP 공식 풀레터에 올라갔습니다', heading: '회원님 이름이 PAP 공식 풀레터에 올라갔습니다',
        body1: '{requester}님이 신청한 촬영{title}의 PAP 매거진 공식 풀레터가 발급되었고, 회원님이 {role}(으)로 이름을 올렸습니다.',
        body2: '풀레터는 매거진 명의의 공식 공문으로, 브랜드·쇼룸 샘플 대여와 로케이션 섭외 자리에서 PAP와 촬영한다는 사실을 증명합니다. 다음 촬영에 회원님 팀도 직접 신청할 수 있습니다(프리미엄 회원, 월 1건).',
        cta: '풀레터 알아보기', foot: '회원님의 인스타그램 아이디가 이 풀레터의 팀 정보와 같아서 보내드리는 안내입니다. 본인이 아니라면 이 메일에 회신해 주세요.' },
  en: { subject: 'Your name is on an official PAP Pull-Letter', heading: 'Your name is on an official PAP Pull-Letter',
        body1: 'The official PAP Magazine Pull-Letter for {requester}’s shoot{title} has been issued, and you are named on it as {role}.',
        body2: 'A Pull-Letter is an official letter in the magazine’s name: proof that you are shooting with PAP when pulling samples from brands and showrooms or securing locations. Your team can request one for your next shoot too (Premium members, one per month).',
        cta: 'About the Pull-Letter', foot: 'You are receiving this because your Instagram handle matches the team details on this Pull-Letter. If this is not you, just reply to this email.' },
  it: { subject: 'Il tuo nome è su una Pull-Letter ufficiale PAP', heading: 'Il tuo nome è su una Pull-Letter ufficiale PAP',
        body1: 'È stata emessa la Pull-Letter ufficiale di PAP Magazine per lo shooting di {requester}{title}, e compari come {role}.',
        body2: 'La Pull-Letter è una lettera ufficiale a nome della rivista: la prova che scatti con PAP quando chiedi campioni a brand e showroom o cerchi location. Anche il tuo team può richiederne una per il prossimo shooting (membri Premium, una al mese).',
        cta: 'Scopri la Pull-Letter', foot: 'Ricevi questo messaggio perché il tuo handle Instagram corrisponde ai dati del team di questa Pull-Letter. Se non sei tu, rispondi a questa email.' },
  fr: { subject: 'Votre nom figure sur une Pull-Letter officielle PAP', heading: 'Votre nom figure sur une Pull-Letter officielle PAP',
        body1: 'La Pull-Letter officielle de PAP Magazine pour le shooting de {requester}{title} a été émise, et vous y figurez en tant que {role}.',
        body2: 'La Pull-Letter est une lettre officielle au nom du magazine : la preuve que vous shootez avec PAP pour emprunter des pièces auprès des marques et des showrooms ou obtenir des lieux. Votre équipe peut aussi en demander une pour son prochain shooting (membres Premium, une par mois).',
        cta: 'Découvrir la Pull-Letter', foot: 'Vous recevez ce message car votre compte Instagram correspond aux informations d’équipe de cette Pull-Letter. Si ce n’est pas vous, répondez simplement à cet e-mail.' },
  es: { subject: 'Tu nombre aparece en una Pull-Letter oficial de PAP', heading: 'Tu nombre aparece en una Pull-Letter oficial de PAP',
        body1: 'Se ha emitido la Pull-Letter oficial de PAP Magazine para la sesión de {requester}{title}, y apareces como {role}.',
        body2: 'La Pull-Letter es una carta oficial en nombre de la revista: la prueba de que haces una sesión con PAP al pedir muestras a marcas y showrooms o conseguir localizaciones. Tu equipo también puede pedir una para su próxima sesión (miembros Premium, una al mes).',
        cta: 'Conoce la Pull-Letter', foot: 'Recibes este mensaje porque tu usuario de Instagram coincide con los datos del equipo de esta Pull-Letter. Si no eres tú, responde a este correo.' },
  ja: { subject: 'あなたの名前が PAP 公式 Pull-Letter に記載されました', heading: 'あなたの名前が PAP 公式 Pull-Letter に記載されました',
        body1: '{requester}さんが申請した撮影{title}の PAPマガジン公式 Pull-Letter が発行され、あなたが{role}として記載されています。',
        body2: 'Pull-Letter は誌名で発行する公式レターで、ブランドやショールームからのサンプル貸し出し、ロケーション交渉の場で PAP との撮影であることを証明します。次の撮影では、あなたのチームも申請できます(プレミアム会員、月1件)。',
        cta: 'Pull-Letter について', foot: 'この Pull-Letter のチーム情報とあなたの Instagram アカウントが一致したため、お知らせしています。お心当たりがない場合は、このメールに返信してください。' },
  zh: { subject: '你的名字出现在 PAP 官方 Pull-Letter 上', heading: '你的名字出现在 PAP 官方 Pull-Letter 上',
        body1: '{requester} 申请的拍摄{title}已获发 PAP 杂志官方 Pull-Letter,你以{role}的身份列于其中。',
        body2: 'Pull-Letter 是以杂志名义出具的官方公函,在向品牌和陈列室借样、洽谈拍摄场地时,可证明你正在与 PAP 合作拍摄。你的团队下次拍摄也可以自行申请(高级会员,每月 1 次)。',
        cta: '了解 Pull-Letter', foot: '由于你的 Instagram 账号与这份 Pull-Letter 的团队信息一致,我们向你发送此通知。如非本人,请直接回复此邮件。' },
  ru: { subject: 'Ваше имя указано в официальном Pull-Letter от PAP', heading: 'Ваше имя указано в официальном Pull-Letter от PAP',
        body1: 'Для съёмки {requester}{title} выдан официальный Pull-Letter от PAP Magazine, и вы указаны в нём как {role}.',
        body2: 'Pull-Letter является официальным письмом от имени журнала и подтверждает, что вы снимаете для PAP, когда берёте образцы у брендов и шоурумов или договариваетесь о локациях. Ваша команда тоже может запросить его для следующей съёмки (премиум-участники, один в месяц).',
        cta: 'О Pull-Letter', foot: 'Вы получили это письмо, потому что ваш аккаунт Instagram совпадает с данными команды в этом Pull-Letter. Если это не вы, просто ответьте на это письмо.' },
  de: { subject: 'Dein Name steht auf einem offiziellen PAP Pull-Letter', heading: 'Dein Name steht auf einem offiziellen PAP Pull-Letter',
        body1: 'Für das Shooting von {requester}{title} wurde der offizielle Pull-Letter von PAP Magazine ausgestellt, und du bist darin als {role} genannt.',
        body2: 'Der Pull-Letter ist ein offizielles Schreiben im Namen des Magazins und belegt, dass du mit PAP shootest, wenn du Samples bei Marken und Showrooms anfragst oder Locations sicherst. Dein Team kann für das nächste Shooting ebenfalls einen anfragen (Premium-Mitglieder, einer pro Monat).',
        cta: 'Mehr zum Pull-Letter', foot: 'Du erhältst diese Nachricht, weil dein Instagram-Konto mit den Teamangaben dieses Pull-Letters übereinstimmt. Wenn du das nicht bist, antworte einfach auf diese E-Mail.' },
};

// 풀레터 발급 메일(신청자)에 붙는 "팀원에게 알려 주세요" 블록
const TEAM_INVITE = {
  ko: { title: '팀원에게도 알려 주세요', body: '이 풀레터에 이름이 올라간 팀원이 아직 PAP 회원이 아닙니다: {names}. 아래 링크를 전달하면 무료로 가입하고, 다음 촬영에는 직접 풀레터를 신청할 수 있습니다.', link: '가입 링크 열기' },
  en: { title: 'Let your team know', body: 'Some teammates named on this Pull-Letter are not PAP members yet: {names}. Forward them the link below: they can join for free and request their own Pull-Letter for the next shoot.', link: 'Open the sign-up link' },
  it: { title: 'Avvisa il tuo team', body: 'Alcuni membri del team indicati in questa Pull-Letter non sono ancora membri PAP: {names}. Inoltra loro il link qui sotto: possono iscriversi gratis e richiedere la propria Pull-Letter per il prossimo shooting.', link: 'Apri il link di iscrizione' },
  fr: { title: 'Prévenez votre équipe', body: 'Certains membres de l’équipe cités sur cette Pull-Letter ne sont pas encore membres de PAP : {names}. Transférez-leur le lien ci-dessous : ils peuvent s’inscrire gratuitement et demander leur propre Pull-Letter pour le prochain shooting.', link: 'Ouvrir le lien d’inscription' },
  es: { title: 'Avisa a tu equipo', body: 'Algunos miembros del equipo que aparecen en esta Pull-Letter aún no son miembros de PAP: {names}. Reenvíales el enlace de abajo: pueden unirse gratis y pedir su propia Pull-Letter para la próxima sesión.', link: 'Abrir el enlace de registro' },
  ja: { title: 'チームの皆さんにも伝えてください', body: 'この Pull-Letter に記載されたチームメンバーのうち、まだ PAP 会員でない方がいます: {names}。下のリンクを転送すれば無料で登録でき、次の撮影では自分で Pull-Letter を申請できます。', link: '登録リンクを開く' },
  zh: { title: '也告诉你的团队', body: '这份 Pull-Letter 上列出的部分团队成员还不是 PAP 会员:{names}。把下面的链接转给他们,就能免费注册,下次拍摄时自行申请 Pull-Letter。', link: '打开注册链接' },
  ru: { title: 'Расскажите команде', body: 'Некоторые члены команды, указанные в этом Pull-Letter, ещё не участники PAP: {names}. Перешлите им ссылку ниже: они смогут бесплатно зарегистрироваться и запросить свой Pull-Letter для следующей съёмки.', link: 'Открыть ссылку для регистрации' },
  de: { title: 'Sag deinem Team Bescheid', body: 'Einige im Pull-Letter genannte Teammitglieder sind noch keine PAP-Mitglieder: {names}. Leite ihnen den Link unten weiter: Sie können sich kostenlos registrieren und für das nächste Shooting selbst einen Pull-Letter anfragen.', link: 'Registrierungslink öffnen' },
};

// 역할 이름 (team_info 의 키)
const ROLE = {
  ko: { photographer: '포토그래퍼', stylist: '스타일리스트', videographer: '비디오그래퍼', makeup: '메이크업 아티스트', hair: '헤어 아티스트', model: '모델', _: '팀원' },
  en: { photographer: 'photographer', stylist: 'stylist', videographer: 'videographer', makeup: 'makeup artist', hair: 'hair stylist', model: 'model', _: 'team member' },
  it: { photographer: 'fotografo', stylist: 'stylist', videographer: 'videomaker', makeup: 'make-up artist', hair: 'hair stylist', model: 'modello', _: 'membro del team' },
  fr: { photographer: 'photographe', stylist: 'styliste', videographer: 'vidéaste', makeup: 'maquilleur', hair: 'coiffeur', model: 'mannequin', _: 'membre de l’équipe' },
  es: { photographer: 'fotógrafo', stylist: 'estilista', videographer: 'videógrafo', makeup: 'maquillador', hair: 'peluquero', model: 'modelo', _: 'miembro del equipo' },
  ja: { photographer: 'フォトグラファー', stylist: 'スタイリスト', videographer: 'ビデオグラファー', makeup: 'メイクアップアーティスト', hair: 'ヘアスタイリスト', model: 'モデル', _: 'チームメンバー' },
  zh: { photographer: '摄影师', stylist: '造型师', videographer: '摄像师', makeup: '化妆师', hair: '发型师', model: '模特', _: '团队成员' },
  ru: { photographer: 'фотограф', stylist: 'стилист', videographer: 'видеограф', makeup: 'визажист', hair: 'парикмахер', model: 'модель', _: 'участник команды' },
  de: { photographer: 'Fotograf', stylist: 'Stylist', videographer: 'Videograf', makeup: 'Make-up-Artist', hair: 'Hairstylist', model: 'Model', _: 'Teammitglied' },
};

/** '@Name', 'instagram.com/name/', ' NAME ' → 'name'. 모르면 '' */
function normHandle(v) {
  let s = String(v || '').trim().toLowerCase();
  const m = s.match(/instagram\.com\/([a-z0-9._]+)/);
  if (m) s = m[1];
  s = s.replace(/^@+/, '').replace(/\/+$/, '');
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : '';
}

/** team_info → [{ role, name, handle }] (신청자 contact 제외, 이름이나 아이디가 있는 사람만) */
function teamMembers(teamInfo) {
  const t = teamInfo && typeof teamInfo === 'object' && !Array.isArray(teamInfo) ? teamInfo : {};
  const out = [];
  Object.keys(t).forEach((role) => {
    if (role === 'contact') return;
    const v = t[role];
    (Array.isArray(v) ? v : [v]).forEach((m) => {
      if (!m || typeof m !== 'object') return;
      const name = String(m.name || '').trim().slice(0, 80);
      const handle = normHandle(m.instagram);
      if (name || handle) out.push({ role, name, handle });
    });
  });
  return out;
}

module.exports = { TEAM_NOTICE, TEAM_INVITE, ROLE, normHandle, teamMembers };
