/**
 * AI 검색·챗봇 계측 하네스 (2026-08-19 신설)
 *
 * 무엇을 지키는가
 *  ① 일반 검색(google.com)을 AI 로 오인하지 않을 것  ← 오인하면 숫자가 통째로 거짓
 *  ② 'ChatGPT-User'(지금 답변 중)를 'GPTBot'(학습)으로 뭉개지 않을 것
 *  ③ utm 이 없어도 AI 리퍼러면 기록할 것            ← 8/19 이전의 구멍
 *  ④ utm 과 리퍼러가 둘 다 오면 두 번 세지 않을 것   ← 챗GPT 가 실제로 둘 다 보낸다
 *  ⑤ 리퍼러 호스트를 저장할 것 (경로만 남기면 출처를 잃는다)
 *  ⑥ AI 가 아닌 유입의 기존 동작을 바꾸지 않을 것    ← 회귀 방지
 *  ⑦ 크롤 기록이 봇이 아닌 요청에는 아무것도 안 할 것
 *  ⑧ 마이그레이션 파일이 증분(+1) 규칙을 갖고 있을 것
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const ai = require(path.join(ROOT, 'api/_lib/aiTraffic.js'));

/* ── ① 일반 검색은 AI 가 아니다 ─────────────────────────────── */
console.log('\n① 일반 검색을 AI 로 오인하지 않는다');
[
  'https://www.google.com/search?q=pap',
  'https://news.google.com/foo',
  'https://www.google.co.jp/',
  'https://search.naver.com/search.naver?query=pap',
  'https://www.bing.com/search?q=pap',
  'https://duckduckgo.com/?q=pap',
  'https://t.co/abc',
  'https://www.instagram.com/',
].forEach((u) => t(u.slice(0, 44), ai.aiReferralPlatform(u) === null, ai.aiReferralPlatform(u)));

/* ── ② AI 리퍼러는 정확히 잡는다 ────────────────────────────── */
console.log('\n② AI 리퍼러 판별');
[
  ['https://chatgpt.com/c/abc', 'chatgpt'],
  ['https://chat.openai.com/', 'chatgpt'],
  ['https://www.perplexity.ai/search/x', 'perplexity'],
  ['https://perplexity.ai/', 'perplexity'],
  ['https://gemini.google.com/app', 'gemini'],
  ['https://claude.ai/chat/1', 'claude'],
  ['https://copilot.microsoft.com/', 'copilot'],
  ['https://cue.search.naver.com/', 'naver_cue'],
  ['https://grok.com/', 'grok'],
].forEach(([u, exp]) => t(exp + ' ← ' + u.slice(0, 34), ai.aiReferralPlatform(u) === exp, ai.aiReferralPlatform(u)));

t('끝점 FQDN 표기(chatgpt.com.)도 잡는다', ai.aiReferralPlatform('https://chatgpt.com./x') === 'chatgpt');
t('빈 리퍼러는 null', ai.aiReferralPlatform('') === null);
t('쓰레기 문자열은 null', ai.aiReferralPlatform('not a url') === null);
t('호스트만 뽑고 경로는 버린다', ai.refererHost('https://chatgpt.com/c/secret-thread-id') === 'chatgpt.com');

/* ── ③ 크롤러 목적 구분 ────────────────────────────────────── */
console.log('\n③ 크롤러 목적(live/index/train) 구분');
[
  ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', 'chatgpt', 'live'],
  ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 'chatgpt', 'index'],
  ['Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'chatgpt', 'train'],
  ['Mozilla/5.0 (compatible; Perplexity-User/1.0)', 'perplexity', 'live'],
  ['Mozilla/5.0 (compatible; PerplexityBot/1.0)', 'perplexity', 'index'],
  ['Mozilla/5.0 (compatible; Claude-User/1.0)', 'claude', 'live'],
  ['Mozilla/5.0 (compatible; ClaudeBot/1.0)', 'claude', 'train'],
  ['Mozilla/5.0 (compatible; Google-Extended)', 'gemini', 'train'],
].forEach(([ua, p, k]) => {
  const got = ai.aiCrawlerInfo(ua);
  t(p + '/' + k, !!got && got.platform === p && got.kind === k, JSON.stringify(got));
});

console.log('\n③-b AI 가 아닌 봇·사람은 null');
[
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0)',
  'Yeti/1.1 (NHN Corp.)',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36',
  '',
].forEach((ua) => t((ua || '(빈 UA)').slice(0, 44), ai.aiCrawlerInfo(ua) === null, JSON.stringify(ai.aiCrawlerInfo(ua))));

/* ── ④ logSocialInclick 동작 (supabase 를 가짜로 갈아 끼운다) ── */
console.log('\n④ 유입 기록 동작');

const inserted = [];
const fakeSupabase = {
  supabaseAdmin: {
    from() {
      return { insert(row) { inserted.push(row); return Promise.resolve({ error: null }); } };
    },
    rpc(name, args) { inserted.push({ __rpc: name, args: args }); return Promise.resolve({ error: null }); },
  },
};

const origResolve = Module._resolveFilename;
const SUPA = path.join(ROOT, 'api/_lib/supabase.js');
Module._resolveFilename = function (request, parent) {
  const r = origResolve.apply(this, arguments);
  return r;
};
require.cache[SUPA] = { id: SUPA, filename: SUPA, loaded: true, exports: fakeSupabase };

const { logSocialInclick } = require(path.join(ROOT, 'api/_lib/socialInclick.js'));
const { logAiCrawl } = require(path.join(ROOT, 'api/_lib/aiCrawlLog.js'));

const HUMAN_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';

function mkReq(o) {
  return {
    url: o.url || '/article/test',
    query: o.query || {},
    headers: Object.assign({ 'user-agent': HUMAN_UA }, o.headers || {}),
    socket: { remoteAddress: '1.2.3.4' },
  };
}

(async function run() {
  // ③ utm 없고 리퍼러만 퍼플렉시티 → 기록되어야 한다 (8/19 이전엔 무시됐다)
  inserted.length = 0;
  await logSocialInclick(mkReq({ headers: { referer: 'https://www.perplexity.ai/search/abc' } }), 'article');
  t('utm 없이 퍼플렉시티 리퍼러 → 1건 기록', inserted.length === 1, inserted);
  t('  src 가 perplexity', inserted[0] && inserted[0].src === 'perplexity', inserted[0] && inserted[0].src);
  t('  referrer_host 저장됨', inserted[0] && inserted[0].referrer_host === 'www.perplexity.ai', inserted[0] && inserted[0].referrer_host);

  // ④ utm 과 리퍼러가 둘 다 → 한 번만
  inserted.length = 0;
  await logSocialInclick(mkReq({
    query: { utm_source: 'chatgpt.com' },
    headers: { referer: 'https://chatgpt.com/c/abc' },
  }), 'article');
  t('utm+리퍼러 동시 → 1건만', inserted.length === 1, inserted.length);
  t('  utm 이 이긴다(src=chatgpt)', inserted[0] && inserted[0].src === 'chatgpt', inserted[0] && inserted[0].src);

  // ⑥ AI 도 utm 도 아니면 기존대로 무시
  inserted.length = 0;
  await logSocialInclick(mkReq({ headers: { referer: 'https://www.google.com/search?q=pap' } }), 'article');
  t('구글 검색 유입은 기록 안 함(기존 동작 유지)', inserted.length === 0, inserted);

  inserted.length = 0;
  await logSocialInclick(mkReq({}), 'article');
  t('리퍼러도 utm 도 없으면 무시', inserted.length === 0, inserted);

  // 기존 utm 경로 회귀
  inserted.length = 0;
  await logSocialInclick(mkReq({ query: { utm_source: 'threads' }, url: '/article/x' }), 'article');
  t('일반 utm(threads) 기존대로 기록', inserted.length === 1 && inserted[0].src === 'threads', inserted);

  // AI 리퍼러라도 봇 UA 면 사람 지표에 안 넣는다
  inserted.length = 0;
  await logSocialInclick(mkReq({
    headers: { referer: 'https://chatgpt.com/', 'user-agent': 'Mozilla/5.0 (compatible; ChatGPT-User/1.0)' },
  }), 'article');
  t('봇 UA 는 사람 유입에 안 넣는다', inserted.length === 0, inserted);

  /* ── ⑦ 크롤 기록 ─────────────────────────────────────────── */
  console.log('\n⑦ 크롤 기록 동작');
  inserted.length = 0;
  await logAiCrawl(mkReq({
    url: '/ja/article/foo?utm_source=x',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2)' },
  }));
  t('GPTBot → rpc 1회', inserted.length === 1 && inserted[0].__rpc === 'ai_crawl_bump', inserted);
  t('  플랫폼 chatgpt / 목적 train',
    inserted[0] && inserted[0].args.p_platform === 'chatgpt' && inserted[0].args.p_kind === 'train',
    inserted[0] && inserted[0].args);
  t('  경로에서 쿼리스트링을 뗀다',
    inserted[0] && inserted[0].args.p_path === '/ja/article/foo',
    inserted[0] && inserted[0].args.p_path);

  inserted.length = 0;
  await logAiCrawl(mkReq({ headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } }));
  t('구글봇은 기록 안 함', inserted.length === 0, inserted);

  inserted.length = 0;
  await logAiCrawl(mkReq({}));
  t('사람 UA 는 기록 안 함', inserted.length === 0, inserted);

  /* ── ⑧ 마이그레이션이 증분 규칙을 갖는다 ────────────────── */
  console.log('\n⑧ 마이그레이션');
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_migrations/132_ai_traffic.sql'), 'utf8');
  t('ai_crawl_daily 생성', /CREATE TABLE IF NOT EXISTS public\.ai_crawl_daily/.test(sql));
  t('기본키가 (day, platform, kind, path)', /PRIMARY KEY \(day, platform, kind, path\)/.test(sql));
  t('증분(+1) 규칙 있음', /DO UPDATE SET hits = public\.ai_crawl_daily\.hits \+ 1/.test(sql));
  t('path 를 함수 안에서 자른다(키 어긋남 방지)', /LEFT\(p_path, 300\)/.test(sql));
  t('RLS 켜짐', /ALTER TABLE public\.ai_crawl_daily ENABLE ROW LEVEL SECURITY/.test(sql));
  t('social_inclicks 에 referrer_host 추가', /ADD COLUMN IF NOT EXISTS referrer_host TEXT/.test(sql));

  /* ── ⑨ SSR 3곳에 배선됐다 ──────────────────────────────── */
  console.log('\n⑨ 배선');
  ['api/seo/article/[slug].js', 'api/seo/editorial/[slug].js', 'api/seo/pepperit/[slug].js'].forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    t(f + ' 에 logAiCrawl 호출', /await logAiCrawl\(req\)/.test(src));
    t(f + ' 에 require', /require\('\.\.\/\.\.\/_lib\/aiCrawlLog'\)/.test(src));
  });

  Module._resolveFilename = origResolve;
  console.log('\n' + (fail === 0 ? '✅' : '❌') + '  통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
