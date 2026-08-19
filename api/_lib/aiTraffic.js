/**
 * aiTraffic.js — AI 검색·챗봇 유입 판별 (2026-08-19 신설)
 *
 * ■ 왜 만들었나
 * 시밀러웹이 "AI 챗봇 유입을 보여준다"고 영업 메일을 보냈다. 그런데 그건
 * **패널 추정치**다. 우리 사이트로 들어오는 트래픽은 우리 서버가 원본을 갖고
 * 있다. 남의 추정치를 사느니 우리 원본을 읽으면 된다.
 * (경쟁사 트래픽은 우리가 만들 수 없다 — 그건 시밀러웹만 판다. 혼동 금지.)
 *
 * ■ 두 가지는 완전히 다른 신호다. 절대 섞지 않는다.
 *   ① 유입(referral) — 사람이 AI 답변의 링크를 눌러서 우리에게 온 것.
 *      Referer 헤더 또는 utm_source 로 판별. **돈이 되는 쪽.**
 *   ② 크롤(crawl)   — AI 회사의 봇이 우리 글을 읽어 간 것.
 *      User-Agent 로 판별. 유입의 **선행 지표**이지 유입이 아니다.
 *
 * ■ 크롤은 다시 세 종류다. 이 구분이 이 파일의 핵심이다.
 *   train — 학습용 수집 (GPTBot, ClaudeBot, Google-Extended …)
 *   index — 검색 색인용 (OAI-SearchBot, PerplexityBot …)
 *   live  — **지금 사람이 질문해서 봇이 우리 페이지를 여는 중**
 *           (ChatGPT-User, Perplexity-User, Claude-User …)
 *   live 가 뜨면 그 순간 누군가의 AI 답변에 우리가 들어가고 있다는 뜻이다.
 *   train 은 1년 뒤 이야기고 live 는 지금 이야기다. 같은 표에 넣으면 안 된다.
 *
 * ■ 알려진 한계 (G-2)
 *   - SSR 상세는 CDN s-maxage=300 캐시가 있다. 같은 URL 의 짧은 시간 내
 *     반복 요청은 함수에 닿지 않는다 → 이 수치는 **하한선이자 추세 지표**다.
 *   - Referer 를 아예 안 보내는 AI 도 있다(정책·앱 내부 브라우저). 그 유입은
 *     'direct' 로 섞여 영영 못 가른다. 우리가 못 재는 구멍이라고 적어 둔다.
 *   - 목록에 없는 새 AI 는 못 잡는다. 그래서 socialInclick 과 달리 여기서는
 *     '모르면 null' 이다 — 아무 리퍼러나 AI 로 세면 숫자가 거짓말을 한다.
 */

'use strict';

/* ── ① 유입: 리퍼러 호스트 → 플랫폼 ──────────────────────────────
   google.com 전체를 넣으면 일반 검색이 전부 AI 로 잡힌다. 반드시
   gemini.google.com 처럼 **AI 전용 호스트만** 적는다. */
const REFERRAL_HOSTS = [
  [/^(.+\.)?chatgpt\.com$/, 'chatgpt'],
  [/^(.+\.)?openai\.com$/, 'chatgpt'],
  [/^(.+\.)?perplexity\.ai$/, 'perplexity'],
  [/^gemini\.google\.com$/, 'gemini'],
  [/^bard\.google\.com$/, 'gemini'],
  [/^aistudio\.google\.com$/, 'gemini'],
  [/^(.+\.)?claude\.ai$/, 'claude'],
  [/^(.+\.)?copilot\.microsoft\.com$/, 'copilot'],
  [/^edgeservices\.bing\.com$/, 'copilot'],
  [/^(.+\.)?grok\.com$/, 'grok'],
  [/^(.+\.)?x\.ai$/, 'grok'],
  [/^(.+\.)?you\.com$/, 'you'],
  [/^(.+\.)?phind\.com$/, 'phind'],
  [/^(.+\.)?felo\.ai$/, 'felo'],
  [/^(.+\.)?genspark\.ai$/, 'genspark'],
  [/^(.+\.)?mistral\.ai$/, 'mistral'],
  [/^(.+\.)?wrtn\.(ai|io)$/, 'wrtn'],          // 뤼튼 (한국)
  [/^(.+\.)?getliner\.com$/, 'liner'],          // 라이너 (한국)
  [/^cue\.search\.naver\.com$/, 'naver_cue'],   // 네이버 큐:
];

/**
 * Referer 헤더에서 AI 플랫폼 이름을 뽑는다.
 * @param {string} refererRaw  req.headers.referer
 * @returns {string|null} 'chatgpt' 등. AI 가 아니면 null.
 */
function aiReferralPlatform(refererRaw) {
  const host = refererHost(refererRaw);
  if (!host) return null;
  for (let i = 0; i < REFERRAL_HOSTS.length; i++) {
    if (REFERRAL_HOSTS[i][0].test(host)) return REFERRAL_HOSTS[i][1];
  }
  return null;
}

/**
 * 리퍼러에서 호스트만 소문자로 뽑는다. 경로·쿼리는 버린다(개인정보).
 * 끝의 점(FQDN 표기 'chatgpt.com.')과 포트를 지운다 — 안 지우면 정규식이 빗나간다.
 * @param {string} refererRaw
 * @returns {string|null}
 */
function refererHost(refererRaw) {
  const s = String(refererRaw == null ? '' : refererRaw).trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    let h = String(u.hostname || '').toLowerCase();
    h = h.replace(/\.+$/, '');
    return h || null;
  } catch (_) {
    return null;
  }
}

/* ── ② 크롤: User-Agent → {platform, kind} ────────────────────────
   순서가 의미를 만든다. 더 좁은 이름(…-User, …SearchBot)을 먼저 놓는다.
   'ChatGPT-User' 를 'gptbot' 규칙이 먼저 삼키면 live 가 train 으로 둔갑한다. */
const CRAWLERS = [
  [/chatgpt-user/i, 'chatgpt', 'live'],
  [/oai-searchbot/i, 'chatgpt', 'index'],
  [/gptbot/i, 'chatgpt', 'train'],

  [/perplexity-user/i, 'perplexity', 'live'],
  [/perplexitybot/i, 'perplexity', 'index'],

  [/claude-user/i, 'claude', 'live'],
  [/claude-searchbot/i, 'claude', 'index'],
  [/claudebot|anthropic-ai|claude-web/i, 'claude', 'train'],

  [/google-extended/i, 'gemini', 'train'],
  [/google-cloudvertexbot/i, 'gemini', 'train'],

  [/mistralai-user/i, 'mistral', 'live'],
  [/duckassistbot/i, 'duckduckgo', 'index'],

  [/meta-externalagent|meta-externalfetcher/i, 'meta', 'train'],
  [/bytespider/i, 'bytedance', 'train'],
  [/amazonbot/i, 'amazon', 'train'],
  [/applebot-extended/i, 'apple', 'train'],
  [/ccbot/i, 'commoncrawl', 'train'],
  [/cohere-ai|cohere-training-data-crawler/i, 'cohere', 'train'],
  [/timpibot/i, 'timpi', 'train'],
];

/**
 * AI 크롤러인지, 어느 회사의 어떤 목적인지 판정한다.
 * @param {string} uaRaw  req.headers['user-agent']
 * @returns {{platform: string, kind: string}|null}  AI 크롤러가 아니면 null.
 */
function aiCrawlerInfo(uaRaw) {
  const ua = String(uaRaw == null ? '' : uaRaw);
  if (!ua) return null;
  for (let i = 0; i < CRAWLERS.length; i++) {
    if (CRAWLERS[i][0].test(ua)) {
      return { platform: CRAWLERS[i][1], kind: CRAWLERS[i][2] };
    }
  }
  return null;
}

module.exports = { aiReferralPlatform, aiCrawlerInfo, refererHost, REFERRAL_HOSTS, CRAWLERS };
