'use strict';
/**
 * 주간 뉴스레터(news-weekly)의 고정 문구 9개 언어 (2026-09-25, 도메니코 "언어는 하나로 통일되어야해").
 *
 * 전에는 본문(뉴스)만 받는 사람 언어였고 틀은 영어였다:
 *   ART · FASHION · BEAUTY · CULTURE / Weekly Briefing — September 21, 2026 /
 *   THIS WEEK ON PAP / EDITORIAL / TREND BRIEFING / FOLLOW @PAP_MAGAZINE / 제목의 "SEP 17"
 * 이제 전부 받는 사람 언어. 남는 라틴 글자는 이름뿐이다(PAP, @pap_magazine, pap-magazine.com).
 * 날짜는 Claude 가 짐작해 쓰던 것(9/20 회차에 "SEP 17")을 버리고 코드가 언어별 형식으로 만든다.
 */

const WEEKLY_COPY = {
  ko: { tag: 'ko-KR', subjectPrefix: 'PAP 이주의 뉴스', tagline: '아트 · 패션 · 뷰티 · 컬처', issueLabel: '주간 브리핑',
        thisWeek: '이번 주 PAP', trend: '트렌드 브리핑', editorial: '에디토리얼', article: '기사',
        follow: '@PAP_MAGAZINE 팔로우', viewSite: 'PAP 매거진 보기' },
  en: { tag: 'en-US', subjectPrefix: 'PAP Weekly News', tagline: 'ART · FASHION · BEAUTY · CULTURE', issueLabel: 'Weekly Briefing',
        thisWeek: 'THIS WEEK ON PAP', trend: 'TREND BRIEFING', editorial: 'EDITORIAL', article: 'ARTICLE',
        follow: 'FOLLOW @PAP_MAGAZINE', viewSite: 'VIEW PAP MAGAZINE' },
  it: { tag: 'it-IT', subjectPrefix: 'PAP Notizie della settimana', tagline: 'ARTE · MODA · BELLEZZA · CULTURA', issueLabel: 'Briefing settimanale',
        thisWeek: 'QUESTA SETTIMANA SU PAP', trend: 'TENDENZE DELLA SETTIMANA', editorial: 'EDITORIALE', article: 'ARTICOLO',
        follow: 'SEGUI @PAP_MAGAZINE', viewSite: 'SCOPRI PAP MAGAZINE' },
  fr: { tag: 'fr-FR', subjectPrefix: 'PAP Actus de la semaine', tagline: 'ART · MODE · BEAUTÉ · CULTURE', issueLabel: 'Briefing hebdomadaire',
        thisWeek: 'CETTE SEMAINE SUR PAP', trend: 'TENDANCES DE LA SEMAINE', editorial: 'ÉDITORIAL', article: 'ARTICLE',
        follow: 'SUIVRE @PAP_MAGAZINE', viewSite: 'DÉCOUVRIR PAP MAGAZINE' },
  es: { tag: 'es-ES', subjectPrefix: 'PAP Noticias de la semana', tagline: 'ARTE · MODA · BELLEZA · CULTURA', issueLabel: 'Resumen semanal',
        thisWeek: 'ESTA SEMANA EN PAP', trend: 'TENDENCIAS DE LA SEMANA', editorial: 'EDITORIAL', article: 'ARTÍCULO',
        follow: 'SIGUE A @PAP_MAGAZINE', viewSite: 'VER PAP MAGAZINE' },
  ja: { tag: 'ja-JP', subjectPrefix: 'PAP 今週のニュース', tagline: 'アート · ファッション · ビューティー · カルチャー', issueLabel: '週刊ブリーフィング',
        thisWeek: '今週のPAP', trend: 'トレンドブリーフィング', editorial: 'エディトリアル', article: '記事',
        follow: '@PAP_MAGAZINE をフォロー', viewSite: 'PAPマガジンを見る' },
  zh: { tag: 'zh-CN', subjectPrefix: 'PAP 本周新闻', tagline: '艺术 · 时尚 · 美容 · 文化', issueLabel: '每周简报',
        thisWeek: '本周 PAP', trend: '趋势简报', editorial: '时尚大片', article: '文章',
        follow: '关注 @PAP_MAGAZINE', viewSite: '浏览 PAP 杂志' },
  ru: { tag: 'ru-RU', subjectPrefix: 'PAP: новости недели', tagline: 'ИСКУССТВО · МОДА · КРАСОТА · КУЛЬТУРА', issueLabel: 'Еженедельный обзор',
        thisWeek: 'НА ЭТОЙ НЕДЕЛЕ В PAP', trend: 'ТРЕНДЫ НЕДЕЛИ', editorial: 'СЪЁМКА', article: 'СТАТЬЯ',
        follow: 'ПОДПИСАТЬСЯ НА @PAP_MAGAZINE', viewSite: 'ОТКРЫТЬ PAP MAGAZINE' },
  de: { tag: 'de-DE', subjectPrefix: 'PAP News der Woche', tagline: 'KUNST · MODE · BEAUTY · KULTUR', issueLabel: 'Wöchentliches Briefing',
        thisWeek: 'DIESE WOCHE BEI PAP', trend: 'TRENDS DER WOCHE', editorial: 'EDITORIAL', article: 'ARTIKEL',
        follow: '@PAP_MAGAZINE FOLGEN', viewSite: 'PAP MAGAZINE ANSEHEN' },
};

/* 2026-09-25 — 모든 회원 메일 공통 틀 (같은 요청의 전수 점검). 전에는 9개 언어 메일 전부
 * 바닥에 "FOLLOW @PAP_MAGAZINE" · "All rights reserved." 가 영어로 붙었다.
 * site: 사이트 메뉴 이름 (메일에서 "어디서 확인하세요" 라고 가리킬 때 사이트 화면 글자와 같아야 찾는다).
 *   mySubs = submission.html mySubsTitle, subsTab = mypage navSubmissions, plTab = navPullletters, myPage = mypage 제목. */
const MAIL_CHROME = {
  ko: { igLabel: 'PAP 매거진 인스타그램', rights: '모든 권리 보유.', weekEditorials: '이주의 에디토리얼', viewMore: 'PAP에서 더 보기',
        creativeKicker: '크리에이티브 팀을 위해', howItWorks: '진행 방식',
        mySubs: '내 서브미션', subsTab: '업로드', plTab: '풀레터', myPage: '마이페이지' },
  en: { igLabel: 'PAP Magazine — Instagram', rights: 'All rights reserved.', weekEditorials: 'THIS WEEK\'S EDITORIALS', viewMore: 'VIEW MORE ON PAP',
        creativeKicker: 'FOR CREATIVE TEAMS', howItWorks: 'HOW IT WORKS',
        mySubs: 'MY SUBMISSIONS', subsTab: 'SUBMISSIONS', plTab: 'PULL-LETTER', myPage: 'My Page' },
  it: { igLabel: 'PAP Magazine su Instagram', rights: 'Tutti i diritti riservati.', weekEditorials: 'GLI EDITORIALI DELLA SETTIMANA', viewMore: 'SCOPRI DI PIÙ SU PAP',
        creativeKicker: 'PER I TEAM CREATIVI', howItWorks: 'COME FUNZIONA',
        mySubs: 'LE MIE SUBMISSION', subsTab: 'INVII', plTab: 'PULL-LETTER', myPage: 'La mia pagina' },
  fr: { igLabel: 'PAP Magazine sur Instagram', rights: 'Tous droits réservés.', weekEditorials: 'LES ÉDITORIAUX DE LA SEMAINE', viewMore: 'VOIR PLUS SUR PAP',
        creativeKicker: 'POUR LES ÉQUIPES CRÉATIVES', howItWorks: 'COMMENT ÇA MARCHE',
        mySubs: 'MES SOUMISSIONS', subsTab: 'SOUMISSIONS', plTab: 'PULL-LETTER', myPage: 'Mon compte' },
  es: { igLabel: 'PAP Magazine en Instagram', rights: 'Todos los derechos reservados.', weekEditorials: 'LOS EDITORIALES DE LA SEMANA', viewMore: 'VER MÁS EN PAP',
        creativeKicker: 'PARA EQUIPOS CREATIVOS', howItWorks: 'CÓMO FUNCIONA',
        mySubs: 'MIS ENVÍOS', subsTab: 'ENVÍOS', plTab: 'PULL-LETTER', myPage: 'Mi página' },
  ja: { igLabel: 'PAPマガジン 公式インスタグラム', rights: '無断転載を禁じます。', weekEditorials: '今週のエディトリアル', viewMore: 'PAPでもっと見る',
        creativeKicker: 'クリエイティブチームへ', howItWorks: 'ご利用の流れ',
        mySubs: 'マイサブミッション', subsTab: '投稿', plTab: 'PULL-LETTER', myPage: 'マイページ' },
  zh: { igLabel: 'PAP 杂志官方 Instagram', rights: '版权所有。', weekEditorials: '本周大片', viewMore: '在 PAP 查看更多',
        creativeKicker: '致创意团队', howItWorks: '申请流程',
        mySubs: '我的投稿', subsTab: '投稿', plTab: 'PULL-LETTER', myPage: '我的页面' },
  ru: { igLabel: 'PAP Magazine в Instagram', rights: 'Все права защищены.', weekEditorials: 'СЪЁМКИ НЕДЕЛИ', viewMore: 'БОЛЬШЕ НА PAP',
        creativeKicker: 'ДЛЯ КРЕАТИВНЫХ КОМАНД', howItWorks: 'КАК ЭТО РАБОТАЕТ',
        mySubs: 'МОИ ПОДАЧИ', subsTab: 'ПУБЛИКАЦИИ', plTab: 'PULL-LETTER', myPage: 'Моя страница' },
  de: { igLabel: 'PAP Magazine auf Instagram', rights: 'Alle Rechte vorbehalten.', weekEditorials: 'DIE EDITORIALS DER WOCHE', viewMore: 'MEHR AUF PAP',
        creativeKicker: 'FÜR KREATIVTEAMS', howItWorks: 'SO FUNKTIONIERT ES',
        mySubs: 'MEINE EINREICHUNGEN', subsTab: 'EINREICHUNGEN', plTab: 'PULL-LETTER', myPage: 'Meine Seite' },
};
function mailChrome(lang) { return MAIL_CHROME[lang] || MAIL_CHROME.en; }

function weeklyCopy(lang) {
  return WEEKLY_COPY[lang] || WEEKLY_COPY.en;
}

/** 'September 21, 2026' 또는 ISO 날짜 → 언어별 날짜. 못 읽으면 원문 그대로. */
function localDate(input, lang, opts) {
  const W = weeklyCopy(lang);
  const d = input instanceof Date ? input : new Date(Date.parse(String(input || '') + (/^\d{4}-\d{2}-\d{2}$/.test(String(input)) ? 'T00:00:00Z' : ' UTC')));
  if (!input || isNaN(d.getTime())) return String(input || '');
  try {
    return new Intl.DateTimeFormat(W.tag, Object.assign({ timeZone: 'UTC' }, opts || { year: 'numeric', month: 'long', day: 'numeric' })).format(d);
  } catch (_) { return String(input); }
}

module.exports = { WEEKLY_COPY, weeklyCopy, localDate, MAIL_CHROME, mailChrome };
