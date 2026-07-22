/**
 * botDetect.js — User-Agent 기반 봇/크롤러 판정 공용 헬퍼.
 *
 * 왜 있나 (2026-07-22, 조회지표 봇 오염 진단):
 *   editorial_views 는 프론트가 상세 진입 시 POST /api/editorials/:id/view 를
 *   fire-and-forget 로 호출할 때만 기록된다. Googlebot 처럼 JS를 렌더하는
 *   크롤러는 이 fetch 를 그대로 실행해 "조회 1건"을 남긴다. 7/18~7/19 에
 *   봇이 카탈로그 전체(~1,900편)를 한 번씩 훑어 views_last7 가 6배(1,165→7,065)
 *   로 튀었고, growth-report 가 이를 '성장'으로 오판했다.
 *
 *   근본 해결은 "기록 단계에서 봇을 거르는 것". 봇 조회를 애초에 INSERT 하지
 *   않으면 리포트는 자동으로 깨끗해진다.
 *
 * 설계 원칙:
 *   - 보수적으로 '확실한 봇'만 잡는다. 사람 트래픽을 봇으로 오판(=조회 누락)하는
 *     쪽보다, 위장 스크래퍼 일부를 놓치는 쪽이 지표 신뢰에 덜 해롭다.
 *   - UA 문자열만 본다. IP·행동 기반 탐지는 범위 밖(별도 이터레이션).
 *   - 헤드리스 브라우저가 진짜 크롬 UA 로 위장하면 못 잡는다 — 이건 한계이며,
 *     정직한 크롤러(구글/빙/각종 SEO·AI 봇)만으로도 관측된 오염의 대부분을 설명한다.
 */

'use strict';

// 소문자 UA 에 대해 매칭. 일반 신호(bot/crawler/spider/slurp)는 광범위하지만
// 'cubot'(휴대폰), 'lobot' 같은 오탐을 피하려 경계(\b) 또는 접미 규칙을 쓴다.
const BOT_PATTERN = new RegExp(
  [
    // 일반 신호
    'bot\\b', 'crawler', 'spider', 'crawling', '\\bslurp\\b',
    // 검색엔진
    'googlebot', 'google-inspectiontool', 'bingbot', 'bingpreview',
    'yandex(bot)?', 'baiduspider', 'duckduckbot', 'duckduckgo',
    'applebot', 'sogou', 'exabot', 'yeti', 'daumoa', // 'yeti'=네이버 크롤러.
    //  주의: 맨 'naver' 는 넣지 않는다 — 네이버 인앱 브라우저를 쓰는 '실제 사람'
    //  UA 에도 'NAVER' 가 들어가 조회가 누락된다(한국 독자 오판). Yeti 로만 잡는다.
    // SEO/마케팅 크롤러
    'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'petalbot',
    'rogerbot', 'screaming frog', 'seznambot', 'dataforseo',
    // AI/LLM 크롤러
    'gptbot', 'oai-searchbot', 'chatgpt-user', 'ccbot', 'claudebot',
    'anthropic-ai', 'claude-web', 'perplexitybot', 'amazonbot',
    'bytespider', 'google-extended', 'cohere-ai', 'meta-externalagent',
    // 소셜 언퍼릴러 (미리보기 페처)
    'facebookexternalhit', 'facebot', 'twitterbot', 'linkedinbot',
    'slackbot', 'telegrambot', 'discordbot', 'whatsapp', 'skypeuripreview',
    'pinterestbot', 'pinterest/', 'redditbot', 'embedly', 'quora link preview',
    // 모니터링/도구
    'uptimerobot', 'pingdom', 'lighthouse', 'chrome-lighthouse',
    'headlesschrome', 'phantomjs', 'python-requests', 'axios/',
    'go-http-client', 'curl/', 'wget', 'okhttp', 'java/',
  ].join('|'),
  'i'
);

/**
 * @param {string} [userAgent]  req.headers['user-agent']
 * @returns {boolean}  확실한 봇/크롤러면 true. 값이 없어도(=UA 미제공) true 로
 *   본다: 정상 브라우저 fetch 는 UA 를 항상 싣고 오므로, UA 없는 요청은
 *   스크립트/봇일 확률이 높다.
 */
function isBot(userAgent) {
  if (userAgent == null || userAgent === '') return true;
  if (typeof userAgent !== 'string') return true;
  return BOT_PATTERN.test(userAgent);
}

module.exports = { isBot };
