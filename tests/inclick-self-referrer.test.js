/**
 * 자기 리퍼러 배제 — 랜딩 비콘은 살리고 내부 이동만 버린다 (2026-08-25 신설)
 *
 * 왜 필요했나 ────────────────────────────────────────────────────────
 * 132 마이그레이션으로 referrer_host 를 남기기 시작하자 우리 자신이 리퍼러
 * 6위(63건)로 나타났고 매일 7~12건씩 늘고 있었다. 첫 진단은 "내부 이동이
 * 새 유입으로 잘못 세어진다"였고, 처방은 "자기 리퍼러면 버린다"였다.
 *
 * 그런데 63건을 실제로 갈라 보니 성격이 정반대인 두 덩어리였다.
 *   진짜 오염 5건  — path ≠ referrer_path, page='article' (내부 이동)
 *   오염 아님 58건 — 랜딩 비콘(/api/inclick)이 자기 페이지에서 fetch 해서
 *                    Referer 헤더가 항상 우리 자신인 것. 인스타 바이오
 *                    링크·뉴스레터·네이버 프로필 유입이 여기 다 들어 있다.
 * 실측(8/19~8/25): page='home' 50건 중 self 47 · external 0.
 *
 * 처방을 그대로 넣었으면 랜딩 계측 58/61(95%)이 조용히 사라지고, 성공 판정
 * (is_internal = 0)까지 통과했을 것이다. 2026-08-12 에 이 비콘을 만든 이유
 * (30일에 ig 4건)가 통째로 되돌아온다.
 *
 * 여기서 지키는 것:
 *   ① 리퍼러 없음(null)은 반드시 기록한다  ← 8/19~8/25 287건. 경계값.
 *   ② 자기 호스트 리퍼러는 기록하지 않는다 ← 내부 이동 차단
 *   ③ 비콘은 바깥 리퍼러(document.referrer)를 실어 보내고 서버가 그것을 쓴다
 *   ④ 옛 캐시 비콘(ref 없음)도 살아남는다  ← 배포 직후 숫자가 새면 안 된다
 *   ⑤ 비콘 바꿔치기가 IP·기기 판정을 망가뜨리지 않는다
 */
'use strict';

const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}
function inject(p, exports) {
  const m = new Module(p, null);
  m.filename = p; m.loaded = true; m.exports = exports;
  require.cache[p] = m;
}

/* 삽입된 행을 모은다 — 진짜 insert 를 부르는지, 무엇을 담는지 본다. */
const inserted = [];
inject(path.join(ROOT, 'api', '_lib', 'supabase.js'), {
  supabaseAdmin: { from: () => ({ insert: async (row) => { inserted.push(row); return { error: null }; } }) },
});

const REAL_GUARD = require(path.join(ROOT, 'api', '_lib', 'clickGuard.js'));
inject(path.join(ROOT, 'api', '_lib', 'clickGuard.js'), {
  extractClientIp: REAL_GUARD.extractClientIp,          // 진짜를 쓴다 — 헤더 복사가 깨지면 잡히도록
  hashIp: (ip) => 'hash:' + ip,
  detectDeviceType: REAL_GUARD.detectDeviceType,        // 진짜
  sanitizeReferrer: REAL_GUARD.sanitizeReferrer,
  isLikelyBot: () => false,
});

const SI = path.join(ROOT, 'api', '_lib', 'socialInclick.js');
const { logSocialInclick, isSelfHost } = require(SI);
const inclickHandler = require(path.join(ROOT, 'api', 'inclick.js'));

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

function mkReq(over) {
  return Object.assign({
    method: 'GET', url: '/article/x', query: {},
    headers: { 'user-agent': UA, 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    socket: { remoteAddress: '10.0.0.1' },
  }, over || {});
}
function mkRes() {
  const r = { code: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.end = () => r;
  return r;
}
async function ssr(referer, url, q) {
  inserted.length = 0;
  const h = { 'user-agent': UA, 'x-forwarded-for': '203.0.113.9' };
  if (referer !== null && referer !== undefined) h.referer = referer;
  await logSocialInclick(mkReq({ url: url || '/article/x', query: q || { utm_source: 'ig' }, headers: h }), 'article');
  return inserted.slice();
}
async function beacon(q, referer) {
  inserted.length = 0;
  const h = { 'user-agent': UA, 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
  if (referer) h.referer = referer;
  await inclickHandler(mkReq({ url: '/api/inclick', query: q, headers: h }), mkRes());
  return inserted.slice();
}

(async () => {
  console.log('[1] isSelfHost — 경계값');
  t('null 은 자기 호스트가 아니다 (리퍼러 없음을 살린다)', isSelfHost(null) === false);
  t('빈 문자열도 아니다', isSelfHost('') === false);
  t('www.pap-magazine.com 은 자기 호스트', isSelfHost('www.pap-magazine.com') === true);
  t('apex pap-magazine.com 도 자기 호스트', isSelfHost('pap-magazine.com') === true);
  t('papkorea.com 도 자기 호스트', isSelfHost('papkorea.com') === true);
  t('대문자도 잡는다', isSelfHost('WWW.PAP-Magazine.COM') === true);
  t('프리뷰 배포도 자기 호스트', isSelfHost('pap-magazine-git-main.vercel.app') === true);
  t('인스타는 자기 호스트가 아니다', isSelfHost('l.instagram.com') === false);
  t('이름만 비슷한 남의 도메인은 아니다', isSelfHost('notpap-magazine.com.evil.io') === false);

  console.log('\n[2] 필수 회귀 2건 — 이 두 줄이 이 패치의 핵심이다');
  const selfRows = await ssr('https://www.pap-magazine.com/', '/article/x');
  t('리퍼러가 우리 자신이면 기록하지 않는다', selfRows.length === 0, selfRows);
  const nullRows = await ssr(null, '/article/x');
  t('리퍼러가 없으면(null) 기록한다  ← 287건이 여기 걸려 있다', nullRows.length === 1, nullRows);
  t('그 행의 referrer_host 는 null', nullRows.length === 1 && nullRows[0].referrer_host === null, nullRows[0]);

  console.log('\n[3] 바깥 유입은 그대로 기록된다');
  const ext = await ssr('https://l.instagram.com/?u=abc', '/article/x');
  t('인스타 리퍼러는 기록된다', ext.length === 1, ext);
  t('호스트가 남는다', ext.length === 1 && ext[0].referrer_host === 'l.instagram.com', ext[0]);
  const apex = await ssr('https://pap-magazine.com/articles', '/article/x');
  t('apex 자기 리퍼러도 막힌다', apex.length === 0, apex);

  console.log('\n[4] 랜딩 비콘 — 58건을 죽이지 않는다');
  const b1 = await beacon({ utm_source: 'ig', page: 'home', path: '/', ref: 'https://www.instagram.com/' },
                          'https://www.pap-magazine.com/?utm_source=ig');
  t('비콘 유입이 기록된다 (헤더 리퍼러가 우리 자신이어도)', b1.length === 1, b1);
  t('바깥 리퍼러가 저장된다', b1.length === 1 && b1[0].referrer_host === 'www.instagram.com', b1[0]);
  t('착륙 경로가 남는다', b1.length === 1 && b1[0].path === '/', b1[0]);
  t('page 라벨이 남는다', b1.length === 1 && b1[0].page === 'home', b1[0]);

  const b2 = await beacon({ utm_source: 'ig', page: 'home', path: '/' },
                          'https://www.pap-magazine.com/?utm_source=ig');
  t('ref 없는 옛 캐시 비콘도 기록된다 (배포 직후 숫자가 새지 않는다)', b2.length === 1, b2);
  t('그때 referrer_host 는 null (우리 자신으로 남기지 않는다)',
    b2.length === 1 && b2[0].referrer_host === null, b2[0]);

  const b3 = await beacon({ utm_source: 'ig', page: 'home', path: '/', ref: 'https://www.pap-magazine.com/articles' },
                          'https://www.pap-magazine.com/?utm_source=ig');
  t('바깥 리퍼러마저 우리 자신이면(내부 이동) 기록하지 않는다', b3.length === 0, b3);

  console.log('\n[5] 비콘 바꿔치기가 다른 값을 망가뜨리지 않는다');
  t('IP 해시가 x-forwarded-for 첫 칸에서 나온다',
    b1.length === 1 && b1[0].ip_hash === 'hash:203.0.113.9', b1[0] && b1[0].ip_hash);
  t('기기 판정이 살아 있다 (mobile)',
    b1.length === 1 && b1[0].device_type === 'mobile', b1[0] && b1[0].device_type);
  t('src 정규화가 그대로', b1.length === 1 && b1[0].src === 'ig', b1[0] && b1[0].src);

  console.log('\n[6] 리퍼러 없는 비콘(앱 내부 브라우저)도 산다');
  const b4 = await beacon({ utm_source: 'kakao', page: 'home', path: '/' });
  t('헤더 리퍼러조차 없어도 기록된다', b4.length === 1, b4);
  t('src 가 kakao 로 남는다', b4.length === 1 && b4[0].src === 'kakao', b4[0]);

  console.log('\n' + (fail ? '✗' : '✓') + ' inclick-self-referrer: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
