/**
 * botDetect.isBot 검증 (2026-07-22, 조회지표 봇 오염 방지).
 * 확실한 봇/크롤러는 잡고, 실제 브라우저 UA 는 통과시켜야 한다.
 * 사람을 봇으로 오판(=조회 누락)하지 않는 것이 회귀의 핵심.
 */
'use strict';

const { isBot } = require('../api/_lib/botDetect');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

console.log('\n=== 봇으로 잡아야 함 ===');
const bots = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/125.0.0.0 Safari/537.36', // 렌더링 UA
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
  'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  'python-requests/2.31.0',
  'curl/8.4.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/125.0.0.0 Safari/537.36',
];
bots.forEach(ua => t('bot: ' + ua.slice(0, 48), isBot(ua) === true, ua));

console.log('\n=== 빈/누락 UA 는 봇 취급 ===');
t('빈 문자열', isBot('') === true);
t('undefined', isBot(undefined) === true);
t('null', isBot(null) === true);
t('숫자 등 비문자열', isBot(12345) === true);

console.log('\n=== 실제 사람 브라우저는 통과(오판 금지) ===');
const humans = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0',
  // 네이버 인앱 브라우저 = 실제 한국 독자. 'yeti'(네이버 크롤러)와 구분돼 통과해야 함.
  'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 1200; 12.4.5)',
];
humans.forEach(ua => t('human: ' + ua.slice(0, 48), isBot(ua) === false, ua));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ bot-detect tests FAILED'); process.exit(1); }
console.log('✅ bot-detect tests passed');
