/**
 * HTML 태그만 지운다 · 꺾쇠 제목은 살린다 (2026-09-03)
 *
 * ■ 무슨 일이 있었나
 *
 * 2026-09-03 04:50 에 나간 X 트윗이 이랬다.
 *
 *     가 젠데이아와 로버트 패틴슨의 결혼식에 초대받았다.
 *
 * 주어가 없다. 기사 원문은 이렇다.
 *
 *     <PAP>가 젠데이아와 로버트 패틴슨의 결혼식에 초대받았다.
 *     … 영화 <더 드라마>의 프로모션 이벤트다.
 *
 * 태그 제거 정규식 /<[^>]+>/g 이 <PAP> 과 <더 드라마> 를 태그로 보고 지웠다.
 * **우리 매체 이름과 작품 제목이 통째로 사라졌다.**
 *
 * ■ 얼마나 (2026-09-03 실측 쿼리)
 *
 *     articles 2,715건 중 48건  (한글 꺾쇠 36 · <PAP> 13, 중복 1)
 *
 * 그리고 같은 정규식이 코드 36곳에 흩어져 있었다. 트윗만의 문제가 아니라
 * rss.xml · rss-editorials · 구글 메타 설명(seoRenderer) · llms-full(AI 색인) ·
 * 검색 임베딩 · 네이버 · 핀터레스트 · 스레드 · 틱톡 에서도 같은 단어가
 * 빠진 채 나가고 있었다. 규칙이 36벌이면 한쪽만 고쳐진다. 그래서 한곳에 모은다.
 *
 * ■ 규칙
 *
 *   지운다   아는 HTML 원소 이름일 때만.        <br> <p> <a href> <img/>
 *   남긴다   모르는 이름                        <PAP> <더 드라마>
 *   남긴다   한글·기호로 시작하는 꺾쇠           <더 드라마> <2026 F/W>
 *   남긴다   뒤에 공백이 오는 부등호             a < b
 *
 * 모르는 것을 지우지 않는 쪽으로 틀린다. 글자를 잃는 것보다 남기는 게 낫다.
 *
 * ■ 여기 안 오는 곳 (일부러 남겨 둔 것)
 *
 *   · api/_lib/validate.js — 입력 위생. 여기서는 **모르는 태그일수록 지워야**
 *     한다. 판단 기준이 정반대라 같은 함수를 쓰면 구멍이 된다.
 *   · 외부 피드·HTML 파서 (celeb-watch · weekly-news · trend-scout ·
 *     studio-import) — 남의 마크업이다. '우리가 아는 태그' 라는 가정이
 *     성립하지 않는다.
 *
 * 이 두 가지는 이 파일을 고칠 때마다 다시 확인할 것. tests/strip-html.test.js
 * 가 두 곳이 이 함수를 쓰지 않는지 지킨다.
 */
'use strict';

/* 본문에 실제로 나타날 수 있는 HTML 원소 이름. 여기 없는 이름은 글자로 본다.
   AMP(웹스토리)와 옛 태그(center·font…)도 포함한다 — 본문에 남아 있다. */
const HTML_TAGS = new Set(('a abbr address area article aside audio b base bdi bdo ' +
  'blockquote body br button canvas caption cite code col colgroup data datalist dd ' +
  'del details dfn dialog div dl dt em embed fieldset figcaption figure footer form ' +
  'h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label ' +
  'legend li link main map mark menu meta meter nav noscript object ol optgroup ' +
  'option output p param picture pre progress q rp rt ruby s samp script section ' +
  'select slot small source span strong style sub summary sup svg path g rect circle ' +
  'table tbody td template textarea tfoot th thead time title tr track u ul var ' +
  'video wbr center font strike tt big marquee nobr blink ' +
  'amp-img amp-video amp-story amp-story-page amp-story-grid-layer amp-analytics'
).split(' '));

/* 여는 태그·닫는 태그·자기닫힘 태그. 이름 뒤에는 공백(속성) 이나 / 나 > 만 온다.
   '<' 바로 뒤가 영문자여야 한다 — 'a < b' 는 걸리지 않는다. */
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?\/?>/g;
const COMMENT = /<!--[\s\S]*?-->/g;

/**
 * @param {*} input 원문(HTML 일 수도, 아닐 수도)
 * @param {string} [sep=' '] 지운 자리에 넣을 것. 종전 호출부가 '' 인 곳이 있어
 *   그대로 받는다 (공백을 넣으면 '강남<b>역</b>' 이 '강남 역' 이 된다).
 * @returns {string} 태그만 걷어낸 글자
 */
function stripHtml(input, sep) {
  const s = String(input == null ? '' : input);
  const gap = sep === undefined ? ' ' : String(sep);
  return s
    .replace(COMMENT, gap)
    .replace(TAG, (m, name) => (HTML_TAGS.has(name.toLowerCase()) ? gap : m));
}

/** 태그 제거 + 연속 공백 정리 + 앞뒤 자르기. 호출부 대부분이 이 조합이었다. */
function stripHtmlTight(input, sep) {
  return stripHtml(input, sep).replace(/\s+/g, ' ').trim();
}


/* ── 체인 중간에서 쓰는 형태 ──────────────────────────────────────────
   종전 호출부는 거의 다 이 모양이었다.

       String(x || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')…

   중간에 끼어 있어서 stripHtml(x) 로 바꾸려면 줄마다 모양이 달라진다.
   그래서 자리만 바꿔 끼울 수 있는 짝을 함께 낸다.

       .replace(/<[^>]+>/g, ' ')  →  .replace(HTML_TAG_RE, dropKnownTags(' '))

   28곳이 전부 같은 모양이라 눈으로 훑기 쉽다. 판단 기준(HTML_TAGS)은
   stripHtml 과 **같은 것 하나**를 본다 — 규칙은 한 벌이다. */
const HTML_TAG_RE = TAG;
function dropKnownTags(gap) {
  const g = gap === undefined ? ' ' : String(gap);
  return (m, name) => (HTML_TAGS.has(String(name).toLowerCase()) ? g : m);
}

module.exports = { stripHtml, stripHtmlTight, dropKnownTags, HTML_TAG_RE, HTML_TAGS };
