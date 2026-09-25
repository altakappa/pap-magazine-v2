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

module.exports = { WEEKLY_COPY, weeklyCopy, localDate };
