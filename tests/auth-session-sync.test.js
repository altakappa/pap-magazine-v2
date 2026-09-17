'use strict';
/**
 * 쿠키 세션 ↔ localStorage 동기화 (2026-09-17, 도메니코 "5번만 진행").
 *
 * 문제: 서버는 httpOnly 쿠키(pap_auth)로도 로그인을 인정하는데 화면은 localStorage 만 본다.
 *   ① 헤더 로그아웃이 쿠키를 안 지워 서버는 7일 동안 계속 회원으로 봤다(공용 PC 보안 구멍).
 *   ② 쿠키만 있고 localStorage 가 비면 화면은 비회원 팝업, 서버는 전체 이미지(Rebel Twin 실측).
 *
 * 정규식으로 훑지 않고 frontend/pap-auth.js 를 실제로 실행한다(가짜 document·localStorage·fetch).
 *   1. 로그아웃: /api/auth/logout 을 POST·credentials same-origin·keepalive 로 부르고 저장소를 비운다.
 *   2. 빈 저장소로 로드: /api/auth/me 를 쿠키(credentials)로 묻고, 회원이면 pap-user 를 복원해 isLoggedIn() 이 참.
 *   3. 401(비회원)이면 아무것도 저장하지 않는다.
 *   4. 저장소에 회원 정보가 있으면 /me 를 묻지 않는다.
 *   5. 같은 탭 세션에서 두 번째 로드는 묻지 않는다(sessionStorage 표식).
 *   6. 캐시버스트: pap-auth.js?v= 가 HTML 10개에서 하나이고 ≥4.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'frontend/pap-auth.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

function makeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function fakeEl() {
  return { innerHTML: '', href: '', textContent: '', setAttribute() {}, removeAttribute() {}, classList: { toggle() {}, contains() { return false; }, remove() {} }, contains() { return false; } };
}

/** pap-auth.js 를 실행하고 컨텍스트를 돌려준다. fetchImpl 은 (url, opts) → Promise<response 흉내>. */
function run(opts) {
  const calls = [];
  const ctx = {
    console,
    localStorage: opts.localStorage || makeStore(),
    sessionStorage: opts.sessionStorage === null ? undefined : (opts.sessionStorage || makeStore()),
    document: { getElementById: () => (opts.dropdown ? fakeEl() : null), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    fetch: (url, o) => { calls.push({ url, o: o || {} }); return opts.fetchImpl ? opts.fetchImpl(url, o) : Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }); },
    CustomEvent: function (n) { this.type = n; },
    setTimeout, clearTimeout,
  };
  ctx.window = ctx;
  ctx.window.location = { href: '/x', pathname: '/x' };
  ctx.window.addEventListener = () => {};
  ctx.window.dispatchEvent = () => {};
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'pap-auth.js' });
  return { ctx, calls };
}
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  console.log('=== 1. 로그아웃이 서버 쿠키까지 지운다 ===');
  {
    const ls = makeStore(); ls.setItem('pap-token', 'tok.jwt'); ls.setItem('pap-user', JSON.stringify({ id: 'u1', email: 'a@b.c' }));
    const { ctx, calls } = run({ localStorage: ls });
    t('저장소에 회원이 있으면 로드 시 /me 를 묻지 않는다', calls.length === 0, JSON.stringify(calls.map((c) => c.url)));
    ctx._papLogout();
    const lo = calls.find((c) => /\/api\/auth\/logout$/.test(c.url));
    t('로그아웃이 /api/auth/logout 을 부른다', !!lo);
    t('POST · credentials same-origin · keepalive(이동 중에도 완료) · Bearer 동봉', !!lo && lo.o.method === 'POST' && lo.o.credentials === 'same-origin' && lo.o.keepalive === true && lo.o.headers && lo.o.headers.Authorization === 'Bearer tok.jwt');
    t('localStorage 의 pap-token·pap-user 를 비운다', ls.getItem('pap-token') === null && ls.getItem('pap-user') === null);
    t('isLoggedIn() 이 거짓이 된다', ctx.isLoggedIn() === false);
    t('홈으로 이동한다', ctx.window.location.href === '/');
  }

  console.log('\n=== 2. 쿠키만 있는 회원: 빈 저장소로 로드하면 /me 로 복원 ===');
  {
    const ss = makeStore();
    const { ctx, calls } = run({
      sessionStorage: ss, dropdown: true,
      fetchImpl: (url) => Promise.resolve({ ok: /\/api\/auth\/me$/.test(url), status: 200, json: () => Promise.resolve({ user: { id: 'u9', email: 'p@pap.com', name: 'P', role: 'user', subscription: 'premium', subscriptionStatus: 'active' } }) }),
    });
    t('로드 직후에는 비회원으로 본다(아직 응답 전)', ctx.isLoggedIn() === false);
    const me = calls.find((c) => /\/api\/auth\/me$/.test(c.url));
    t('/api/auth/me 를 credentials same-origin(쿠키)으로 한 번 묻는다', !!me && me.o.credentials === 'same-origin' && calls.length === 1);
    await tick(); await tick(); await tick();
    const u = JSON.parse(ctx.localStorage.getItem('pap-user') || 'null');
    t('응답의 회원 정보로 pap-user 를 복원한다 (id·email·subscription·subscriptionStatus)', !!u && u.id === 'u9' && u.subscription === 'premium' && u.subscriptionStatus === 'active', JSON.stringify(u));
    t('복원 뒤 isLoggedIn() 이 참', ctx.isLoggedIn() === true);
    t('pap-token 은 만들지 않는다(httpOnly 라 읽을 수 없다 — API 는 쿠키로 통한다)', ctx.localStorage.getItem('pap-token') === null);
    t('세션 표식(pap-sess-checked)을 남긴다', ss.getItem('pap-sess-checked') === '1');
  }

  console.log('\n=== 3. 비회원(401): 아무것도 저장하지 않는다 ===');
  {
    const { ctx, calls } = run({});
    await tick(); await tick(); await tick();
    t('/me 를 한 번 묻는다', calls.length === 1 && /\/api\/auth\/me$/.test(calls[0].url));
    t('저장소는 그대로 비어 있다 · isLoggedIn() 거짓', ctx.localStorage.getItem('pap-user') === null && ctx.isLoggedIn() === false);
  }

  console.log('\n=== 4·5. 같은 탭 세션에서는 다시 묻지 않는다 / sessionStorage 가 없어도 죽지 않는다 ===');
  {
    const ss = makeStore(); ss.setItem('pap-sess-checked', '1');
    const { calls } = run({ sessionStorage: ss });
    t('표식이 있으면 /me 를 묻지 않는다', calls.length === 0);
    let ok = true, n = 0;
    try { n = run({ sessionStorage: null }).calls.length; } catch (e) { ok = false; }
    t('sessionStorage 가 없는 환경(사파리 프라이빗 등)에서도 예외 없이 /me 를 묻는다', ok && n === 1);
  }

  console.log('\n=== 6. 캐시버스트 ===');
  {
    const htmls = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html'));
    const vs = new Set();
    for (const h of htmls) (fs.readFileSync(path.join(ROOT, 'frontend', h), 'utf8').match(/pap-auth\.js\?v=(\d+)/g) || []).forEach((m) => vs.add(m));
    t('pap-auth.js?v= 가 HTML 전체에서 하나이고 ≥4', vs.size === 1 && Number([...vs][0].split('=')[1]) >= 4, [...vs].join(','));
  }

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ auth-session-sync FAILED'); process.exit(1); }
  console.log('✅ auth-session-sync passed');
})();
