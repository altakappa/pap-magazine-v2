/**
 * articleSubmission.js — 아티클 기고의 규칙 한 벌 (2026-11-12 신설)
 *
 * 도메니코 2026-11-11: "아티클 서브미션은 기사보다 좀더 전문화된 긴글을 쓰는거지.
 *   패션, 뷰티, 트렌드, 라이프스타일, IT, 스포츠 등등 모든 카테고리에 대한 글을
 *   쓸수있고 이미지도 같이 싣을수있어."
 *
 * ■ 왜 별도 모듈인가
 * 폼(브라우저)과 서버가 **같은 규칙**을 봐야 한다. 규칙이 두 벌이면 한쪽만
 * 고쳐진다 — 에디토리얼 쪽에서 이미 겪었다(submissionCategories.js 가 생긴
 * 이유도, 자동번역이 장르 버튼 글자를 바꿔 화이트리스트에서 탈락한 사고였다).
 * 그래서 카테고리 화이트리스트·본문 하한·세는 방법을 여기 한 곳에 둔다.
 *
 * ■ 본문 하한 — 언어마다 다르다
 * 영문 800단어 / 국문 1,600자. 같은 분량의 글을 영어는 단어로, 한국어는
 * 글자로 세는 것이 자연스럽다(한국어는 조사·어미가 붙어 단어 수가 적게 나온다).
 *
 * ■ 세는 방법을 고정하는 이유
 * "800단어"가 사람마다 다르게 세지면 통과·탈락이 흔들린다. 영문은 공백으로
 * 나눈 토큰, 국문은 **공백을 뺀 글자 수**로 고정한다(공백을 넣으면 줄바꿈이
 * 많은 글이 유리해진다).
 */

'use strict';

/* 제출자가 고르는 세부 분류 → articles.category
   세부 분류 원본은 article_submissions.topic 에 따로 남긴다(나중 필터 확장용). */
const TOPIC_TO_CATEGORY = {
  fashion:   'Fashion',
  beauty:    'Beauty',
  trend:     'Culture',
  tech:      'Culture',
  sport:     'Culture',
  lifestyle: 'Life',
  art:       'Art',
};

const TOPICS = Object.keys(TOPIC_TO_CATEGORY);
const CATEGORIES = Array.from(new Set(Object.values(TOPIC_TO_CATEGORY)));

const BODY_LANGS = ['en', 'ko'];

/* 본문 하한 (도메니코 승인 — 내 추천 그대로) */
const MIN_EN_WORDS = 800;
const MIN_KO_CHARS = 1600;

/* 길이 상한 — userHtml.js 의 MAX.content(50,000자)보다 넉넉하면 안 된다. */
const MAX = {
  title: 150,
  subtitle: 200,
  body: 50000,
  authorBio: 300,
  authorName: 60,
  sources: 2000,
};

/* 이미지: 대표 1장 필수 + 본문 0~9장 */
const MAX_BODY_IMAGES = 9;

/** 세부 분류를 정규화한다. 모르는 값은 null (화이트리스트 밖은 받지 않는다). */
function normalizeTopic(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase().replace(/[\s_-]+/g, '');
  const alias = { it: 'tech', technology: 'tech', sports: 'sport', trends: 'trend', life: 'lifestyle' };
  const key = alias[t] || t;
  return Object.prototype.hasOwnProperty.call(TOPIC_TO_CATEGORY, key) ? key : null;
}

/** 세부 분류 → articles.category. 모르는 값은 null. */
function categoryForTopic(v) {
  const t = normalizeTopic(v);
  return t ? TOPIC_TO_CATEGORY[t] : null;
}

/** 작성 언어를 정규화한다. 'ko'/'en' 만. 그 외는 null. */
function normalizeBodyLang(v) {
  const l = String(v == null ? '' : v).trim().toLowerCase().slice(0, 2);
  return BODY_LANGS.indexOf(l) === -1 ? null : l;
}

/** 영문 단어 수 — 공백으로 나눈 토큰. */
function countWords(body) {
  return String(body == null ? '' : body).trim().split(/\s+/).filter(Boolean).length;
}

/** 국문 글자 수 — 공백을 뺀 글자. 줄바꿈이 많은 글이 유리해지지 않게 한다. */
function countChars(body) {
  return String(body == null ? '' : body).replace(/\s+/g, '').length;
}

/**
 * 작성 언어에 맞는 분량을 세고 하한을 넘었는지 판정한다.
 * @returns {{unit:'words'|'chars', count:number, min:number, ok:boolean}}
 */
function measureBody(body, bodyLang) {
  const lang = normalizeBodyLang(bodyLang) || 'en';
  if (lang === 'ko') {
    const count = countChars(body);
    return { unit: 'chars', count, min: MIN_KO_CHARS, ok: count >= MIN_KO_CHARS };
  }
  const count = countWords(body);
  return { unit: 'words', count, min: MIN_EN_WORDS, ok: count >= MIN_EN_WORDS };
}


/* ── 본문은 평문이다. HTML 태그를 받지 않는다 ─────────────────────────
 *
 * 왜 이게 보안 문제인가 (2026-11-12 확인):
 *   `articles.content` 는 공개 상세에서 **그대로 innerHTML 로 들어간다.**
 *   frontend/pap-content-article.js:
 *     if (a.desc.indexOf('<') !== -1 && a.desc.indexOf('>') !== -1) descEl.innerHTML = a.desc;
 *   지금까지는 안전했다 — 기사를 쓰는 사람이 관리자뿐이어서 그 HTML 은 의도된
 *   것이었다. 그런데 기고가 열리면 **누구나(무료 회원 포함)** 그 칸에 글을 넣는다.
 *   태그를 그대로 받으면 저장형 XSS 가 된다. 커뮤니티에서 똑같은 모양을
 *   2026-11-07 감사(H-1)에서 이미 봤다.
 *
 * 왜 userHtml.hasDangerousHtml 을 쓰지 않나:
 *   그 함수는 `javascript:` 같은 문자열도 거부한다. 기고 주제에는 **IT·테크**가
 *   있다 — 자바스크립트를 다루는 글이 본문에 그 단어를 쓰는 건 지극히 정상이고,
 *   태그가 없으면 실행되지도 않는다. 거부 목록을 넓게 치면 멀쩡한 글이 막힌다.
 *   필요한 것은 **태그를 막는 것**이다: 태그가 없으면 어떤 스킴 문자열도 실행되지
 *   않는다. 그래서 규칙을 하나로 좁힌다 — "본문은 평문, 태그 금지."
 *
 * 그리고 승인 때는 우리가 **직접** 안전한 HTML 을 만든다(bodyToSafeHtml):
 *   문단마다 <p> 로 감싸고 안쪽 글자는 이스케이프한다. 렌더러의 raw-HTML 분기를
 *   타지만 그 HTML 은 우리가 만든 것이므로 안전하고, 문단 간격도 제대로 나온다.
 */
/* `<` **바로 뒤**에 `/` 또는 글자가 와야 태그로 본다 — HTML 파서와 같은 조건이다.
 * 느슨하게 `<\s*[a-zA-Z]` 로 두면 "a < b 이고 c > d" 같은 산문이 태그로 잡힌다.
 * (실측: 이 오탐을 테스트가 먼저 잡았다. IT·수학 얘기를 쓰는 글에서 흔하다.)
 * 반대로 "< script>" 는 브라우저도 태그로 읽지 않으므로 막을 필요가 없다.
 * 태그 이름 뒤에는 공백이나 `>` 만 온다 — 속성은 그 공백 뒤에 붙는다. */
const TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9]{0,20}(\s[^<>]*)?>/;

/** 본문에 HTML 태그처럼 보이는 것이 있나. 있으면 받지 않는다. */
function hasHtmlTag(v) {
  return TAG_RE.test(String(v == null ? '' : v));
}

/** 서버측 HTML 이스케이프. 따옴표까지 — 속성 안에 들어갈 수도 있다. */
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 평문 본문 → 안전한 문단 HTML. articles.content 에 들어갈 값을 만든다.
 * 빈 줄로 문단을 나누고, 각 문단의 글자는 이스케이프한다.
 */
function bodyToSafeHtml(body) {
  return String(body == null ? '' : body)
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>')
    .join('\n');
}

module.exports = {
  TOPIC_TO_CATEGORY,
  TOPICS,
  CATEGORIES,
  BODY_LANGS,
  MIN_EN_WORDS,
  MIN_KO_CHARS,
  MAX,
  MAX_BODY_IMAGES,
  normalizeTopic,
  categoryForTopic,
  normalizeBodyLang,
  countWords,
  countChars,
  measureBody,
  TAG_RE,
  hasHtmlTag,
  escapeHtml,
  bodyToSafeHtml,
};
