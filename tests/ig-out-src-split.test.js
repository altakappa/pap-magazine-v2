/**
 * ig-out src 판정 회귀 (2026-11-26 목요일 확장).
 *
 * [근거] 11/19~11/26 ig_outclicks_human 의 'other' 가 97 → 317 로 3배.
 * 그중 referrer '/' 묶음은 하루 18~79건 · 건마다 IP 전부 다름 · 데스크톱 100% ·
 * 3분 안에 50건씩 몰림(교훈 7 의 봇 함대 모양). 그런데 'other' 는 '모르는 src'
 * 와 'src 없음' 이 한 통이라 어느 쪽인지 데이터로 가를 수 없었다.
 * 또 /archive 푸터 링크는 src=archive 를 달고 나가는데 등록이 빠져 'other' 였다.
 *
 * 소스 정규식이 아니라 핸들러를 **실제로 돌려** 적힌 src 를 확인한다.
 */
'use strict';
const path = require('path');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

// ── 스텁: DB·레이트리밋 (실제 네트워크 금지) ──
const inserted = [];
const supaPath = require.resolve(path.join(__dirname, '..', 'api/_lib/supabase.js'));
const rlPath = require.resolve(path.join(__dirname, '..', 'api/_lib/rateLimit.js'));
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: {
  supabase: null,
  supabaseAdmin: { from: () => ({ insert: async (row) => { inserted.push(row); return { error: null }; } }) },
} };
require.cache[rlPath] = { id: rlPath, filename: rlPath, loaded: true, exports: {
  rateLimitStrict: async () => false,
} };

const igOut = require(path.join(__dirname, '..', 'api/ig-out.js'));
const { classifySrc, SRC_WHITELIST } = igOut;

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
function mkReq(url, extraHeaders) {
  const u = new URL(url, 'https://www.pap-magazine.com');
  const query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  return { method: 'GET', url: u.pathname + u.search, query,
    headers: Object.assign({ 'user-agent': UA, referer: 'https://www.pap-magazine.com/' }, extraHeaders || {}) };
}
function mkRes() {
  const r = { code: null, loc: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return { send: () => r, json: () => r }; };
  r.redirect = (c, l) => { r.code = c; r.loc = l; return r; };
  return r;
}
async function hit(url, h) { inserted.length = 0; const res = mkRes(); await igOut(mkReq(url, h), res); return { res, row: inserted[0] }; }

(async () => {
  console.log('\n=== classifySrc 경계값 ===');
  t('빈 문자열 → nosrc', classifySrc('') === 'nosrc');
  t('null/undefined → nosrc', classifySrc(null) === 'nosrc' && classifySrc(undefined) === 'nosrc');
  t('공백만 → nosrc', classifySrc('   ') === 'nosrc');
  t('등록된 이름 그대로', classifySrc('ssr_top') === 'ssr_top');
  t('대문자도 등록 이름으로', classifySrc('SSR_TOP') === 'ssr_top');
  t('모르는 이름 → other (등록 누락 신호는 그대로)', classifySrc('home') === 'other');
  t("'nosrc' 를 직접 보내도 other — 위조로 통을 바꿀 수 없다", classifySrc('nosrc') === 'other');
  t("'other' 를 직접 보내도 other", classifySrc('other') === 'other');
  t('archive 등록됨', SRC_WHITELIST.has('archive'));
  t('nosrc 는 화이트리스트에 없다', !SRC_WHITELIST.has('nosrc'));

  console.log('\n=== 핸들러를 실제로 돌린다 ===');
  const prof = encodeURIComponent('https://www.instagram.com/pap_magazine/');
  let r = await hit('/api/ig-out?to=profile&url=' + prof);
  t('src 없음 → nosrc 로 기록', r.row && r.row.src === 'nosrc', r.row);
  t('src 없음도 리다이렉트는 완료(302 → IG)', r.res.code === 302 && /instagram\.com\/pap_magazine/.test(r.res.loc), r.res);

  r = await hit('/api/ig-out?src=archive&to=profile&url=' + prof);
  t('/archive 링크 → archive 로 기록 (석 달간 other 였다)', r.row && r.row.src === 'archive', r.row);

  r = await hit('/api/ig-out?src=homepage_grid&to=profile&url=' + prof);
  t('모르는 src → other', r.row && r.row.src === 'other', r.row);

  r = await hit('/api/ig-out?src=ssr_article&to=post&url=' + encodeURIComponent('https://www.instagram.com/p/ABC123/?igshid=x'));
  t('등록 src 는 종전 그대로', r.row && r.row.src === 'ssr_article' && r.row.to_type === 'post', r.row);
  t('추적 쿼리 제거 보존', r.res.loc === 'https://www.instagram.com/p/ABC123/', r.res.loc);

  r = await hit('/ig/youtube');
  t('경로형 /ig/:src 는 종전대로 그 src (nosrc 아님)', r.row && r.row.src === 'youtube', r.row);

  r = await hit('/api/ig-out?src=&to=profile&url=' + prof);
  t('src= (빈 값) → nosrc', r.row && r.row.src === 'nosrc', r.row);

  console.log('\n=== 안전: 오픈 리다이렉터·봇 동작 불변 ===');
  r = await hit('/api/ig-out?url=' + encodeURIComponent('https://evil.example.com/'));
  t('instagram 밖 URL → 홈으로, 기록 없음', r.res.code === 302 && !/evil/.test(r.res.loc) && !r.row, r.res);
  r = await hit('/api/ig-out?to=profile&url=' + prof, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
  t('크롤러는 리다이렉트만, 기록 없음 (src 없어도)', r.res.code === 302 && !r.row, r.row);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
