/**
 * 발신 링크를 IG 우선으로 조립한다 (2026-08-22)
 * ────────────────────────────────────────────────────────────────────
 * 도메니코: "모든 파이프라인을 이어서 IG로 우선시되게 조정해줘."
 *
 * ■ 왜 스레드·X 가 급한가 — 실측이 가리킨 곳
 *
 * 외부→웹 유입 30일 1,367건의 출처:
 *     threads  560 (7일 213)    ← 1위
 *     chatgpt  320
 *     x        214 (7일 214)    ← 3위
 *     ig        76 · naver 25 · youtube 13 · pinterest 6 · kakao 1
 *
 * **스레드+X 가 774건, 전체의 57%다.** 그런데 성장 가이드라인(2026-08-08)에서
 * 스레드·X 는 "① PAP 인스타그램으로 보내는 파이프"로 정의돼 있다.
 * 실제로는 둘 다 **웹으로만** 보내고 있었다. 헌법과 코드가 어긋나 있었다.
 *
 * ■ 무엇을 근거로 IG 게시물인가
 *
 * 같은 페이지·같은 방문자로 이미 비교돼 있다(30일):
 *     게시물(to=post) 약 1,394  vs  프로필(to=profile) 약 421  → 3.3 : 1
 * 원본 보유율도 높다: 화보 95.0% · 기사 87.7%.
 *
 * ■ 무엇을 하지 않는가 — 웹을 끊지 않는다
 *
 * 웹은 2순위 도달점이고 유료 구독 사다리가 거기 있다. 성장 가이드라인 8항
 * (두 도달점은 서로의 파이프)도 한쪽을 없애지 말라고 못박는다.
 * 그래서 **한 답글 안에 두 링크를 넣되 IG 를 먼저** 둔다.
 * "우선시"는 "독점"이 아니다. 게시 횟수가 늘지 않으니 X 과금도 그대로다.
 *
 * ■ 계측
 *
 * IG 링크는 /api/ig-out 을 경유한다 — 그래야 ig_outclicks_human 에
 * src=threads / src=x 로 찍힌다. 그러면 같은 채널의 두 방향을 나란히 볼 수 있다:
 *     threads → 웹  (social_inclicks, utm_source=threads)
 *     threads → IG  (ig_outclicks_human, src=threads)
 * 이 대조가 없으면 "IG 우선으로 바꾼 게 효과가 있었나"에 영원히 답할 수 없다.
 */

'use strict';

const SITE = 'https://www.pap-magazine.com';
const IG_PROFILE = 'https://www.instagram.com/pap_magazine/';

/** 이 채널 이름은 api/ig-out.js 의 SRC_WHITELIST 와 같아야 한다.
 *  다르면 조용히 'other' 로 뭉개져 채널별 판정이 불가능해진다. */
const CHANNELS = new Set(['threads', 'x', 'newsletter', 'youtube', 'naverblog']);

/**
 * IG 목적지 URL (계측 경유).
 * @param {string} igUrl  원본 인스타그램 게시물 URL (없으면 프로필로)
 * @param {string} channel 'threads' | 'x' | ...
 */
function igOutUrl(igUrl, channel) {
  const src = CHANNELS.has(channel) ? channel : 'other';
  const raw = String(igUrl || '');
  const hasPost = /instagram\.com/.test(raw);
  const to = hasPost ? 'post' : 'profile';
  // 추적 쿼리(?igsh=…)는 떼고 보낸다 — 링크가 길어지고 미리보기가 나빠진다.
  const target = hasPost ? raw.split('?')[0] : IG_PROFILE;
  return SITE + '/api/ig-out?src=' + encodeURIComponent(src)
       + '&to=' + to + '&url=' + encodeURIComponent(target);
}

/**
 * 발신 게시물의 링크 블록. IG 가 먼저, 웹이 다음.
 * 원본이 없으면 IG 는 프로필로 간다 — 그래도 IG 가 먼저다.
 *
 * 원본 IG URL 의 필드명이 호출부마다 다르다 — 한 곳에서 전부 받는다.
 *   editorials/articles 행   source_instagram_url
 *   SPA 로컬 객체            ig
 *   instagramImport 정규화   permalink
 * 새 호출부가 또 다른 이름을 쓰면 여기 한 줄만 늘린다. 호출부마다 삼항을
 * 쓰기 시작하면 "규칙이 두 벌"이 되고 한쪽만 고쳐진다.
 * @param {{url?:string, source_instagram_url?:string, ig?:string, permalink?:string}} art
 * @param {string} channel
 * @param {string} webUrl  utm 이 이미 붙은 웹 링크 (호출부가 만든다)
 * @param {{lang?:string}} [opts]
 * @returns {string} 여러 줄 문자열
 */
function igFirstLinkBlock(art, channel, webUrl, opts) {
  const lang = (opts && opts.lang) || 'ko';
  const igUrl = String((art && (art.source_instagram_url || art.ig || art.permalink)) || '');
  const L = lang === 'ko'
    ? { ig: '인스타그램 원본', web: '웹에서 전문 보기' }
    : { ig: 'On Instagram', web: 'Full story' };
  const lines = [L.ig + ' → ' + igOutUrl(igUrl, channel)];
  if (webUrl) lines.push(L.web + ' → ' + String(webUrl));
  return lines.join('\n');
}

/**
 * 링크를 딱 하나만 넣을 수 있는 채널의 목적지 (2026-09-03)
 * ────────────────────────────────────────────────────────────────────
 * 도메니코 2026-09-03: "모든 사이트에서의 주 도달은 웹사이트가 아닌
 * 인스타그램이고 서브 도달은 웹사이트입니다."
 *
 * 스레드·X 는 한 게시물에 두 링크를 넣을 수 있어서 igFirstLinkBlock 으로
 * "IG 먼저, 웹 다음"을 표현했다. 그런데 **핀터레스트 핀은 목적지 링크가
 * 딱 하나**다. 순서로 우선순위를 표현할 수 없으므로 IG 하나만 남긴다.
 * (도메니코 확정: "인스타 하나만")
 *
 * ig-out 을 경유하지 않는다 — 핀터레스트가 리다이렉트 링크를 스팸으로
 * 판정할 위험이 있고, 실제 기존 핀 366개도 인스타 원본 URL 을 직접 쓴다.
 * 계측은 핀터레스트 자체 아웃바운드 클릭 지표로 한다.
 *
 * 원본 인스타 주소가 없으면 웹으로 폴백한다. 발행 화보의 94.9% 는 원본이
 * 있지만(2026-09-03 실측 2,179/2,295), 없는 건을 프로필로 보내면 어느
 * 화보인지 알 수 없는 곳에 떨어뜨리는 셈이라 웹 화보 페이지가 낫다.
 *
 * @param {{source_instagram_url?:string, ig?:string, permalink?:string, slug?:string}} row
 * @param {string} [webPath]  폴백 경로. 기본 '/editorial/<slug>'
 * @returns {{url:string, isIg:boolean}}
 */
function singleLinkDestination(row, webPath) {
  const raw = String((row && (row.source_instagram_url || row.ig || row.permalink)) || '');
  if (/^https?:\/\/(www\.)?instagram\.com\//i.test(raw)) {
    // 추적 쿼리(?igsh=…)는 떼고 보낸다.
    return { url: raw.split('?')[0], isIg: true };
  }
  const path = webPath || ('/editorial/' + encodeURIComponent(String((row && row.slug) || '')));
  return { url: SITE + path, isIg: false };
}

/**
 * 링크가 클릭조차 안 되는 채널의 표기 (2026-09-03)
 * ────────────────────────────────────────────────────────────────────
 * 틱톡 캡션의 URL 은 클릭되지 않는다. 계측도 불가능하다.
 * 남는 수단은 "눈으로 읽고 손으로 찾아가게 하는 것" 하나뿐이라
 * **읽기 쉬운 표기**가 곧 성능이다. 그래서 ig-out 도 utm 도 붙이지 않는다
 * (붙이면 길어지기만 하고 아무 이득이 없다).
 *
 * 여기 상수를 두는 이유는 계정 핸들이 채널마다 흩어지지 않게 하기 위해서다.
 */
const IG_HANDLE = '@pap_magazine';
const IG_HANDLE_URL = 'instagram.com/pap_magazine';

module.exports = {
  igOutUrl, igFirstLinkBlock, singleLinkDestination,
  CHANNELS, SITE, IG_PROFILE, IG_HANDLE, IG_HANDLE_URL,
};
