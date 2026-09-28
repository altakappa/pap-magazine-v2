/*
 * pinterest-demo.test.js  (2026-09-28, 도메니코 "응")
 *
 * 핀터레스트 Standard 승급이 8/14 영상으로 거절됐다 ("API usage is not visible in the video demo").
 * 재녹화용 어드민 데모 화면이 심사 요구 세 장면(OAuth, POST /v5/pins, 핀터레스트에서 핀 보기)을
 * 담는지, 그리고 비밀값을 새지 않고 실서비스 발행을 건드리지 않는지 지킨다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const D = require(path.join(ROOT, 'api/_lib/pinterestDemo'));
const API = rd('api/admin/pinterest-demo.js');
const PAGE = rd('frontend/pinterest-demo.html');
const VJ = JSON.parse(rd('vercel.json'));

console.log('\n[1] OAuth state');
const now = 1790000000000;
const st = D.signState('sec', now);
ok(D.verifyState(st, 'sec', now + 1000), '방금 만든 state 는 통과');
ok(!D.verifyState(st, 'other', now + 1000), '다른 비밀키로는 실패');
ok(!D.verifyState(st, 'sec', now + D.STATE_TTL_MS + 1), '10분 지나면 실패');
ok(!D.verifyState(st.replace(/.$/, (c) => (c === '0' ? '1' : '0')), 'sec', now + 1000), '서명 한 글자만 바꿔도 실패');
ok(!D.verifyState('', 'sec', now) && !D.verifyState(st, '', now), '빈 state·빈 비밀키는 실패');

console.log('\n[2] 승인 URL');
const u = new URL(D.authorizeUrl(st, {}));
ok(u.origin + u.pathname === 'https://www.pinterest.com/oauth/', '핀터레스트 OAuth 주소');
ok(u.searchParams.get('redirect_uri') === 'https://www.pap-magazine.com/pinterest-demo', 'redirect_uri 가 데모 화면');
ok(['boards:read', 'boards:write', 'pins:read', 'pins:write'].every((s) => u.searchParams.get('scope').split(',').includes(s)), '권한 4개 요청');
ok(u.searchParams.get('client_id') === '1587332', '앱 1587332');

console.log('\n[3] 핀 요청 본문');
const pl = D.buildPinPayload({ slug: 'a b', title: 'Echo', issue: 'No.1' }, 'B1', { contentType: 'image/jpeg', base64: 'x'.repeat(4096) });
ok(pl.board_id === 'B1' && pl.link === 'https://www.pap-magazine.com/editorial/a%20b', '보드·원문 링크');
ok(pl.media_source.source_type === 'image_base64', '샌드박스용 base64 이미지 (외부 URL 못 가져옴, 8/14 실측)');
const red = D.redactPayload(pl);
ok(!/x{100}/.test(JSON.stringify(red)) && /KB>$/.test(red.media_source.data), '화면용 본문은 이미지 데이터를 크기로만');
ok(pl.media_source.data.length === 4096, '원본 본문은 그대로 (redact 가 원본을 안 바꾼다)');
ok(D.pinUrl('123') === 'https://www.pinterest.com/pin/123/', '핀 URL');

console.log('\n[4] 엔드포인트 안전');
ok(/requireAdmin\(req, res\)/.test(API), '관리자 전용');
ok(/D\.SANDBOX_API \+ '\/pins'/.test(API) && !/PROD_API \+ '\/pins'/.test(API), '핀 생성은 샌드박스에서만');
ok(!/access_token:\s*tok/.test(API) && !/refresh_token/.test(API), '토큰을 응답에 싣지 않는다');
ok(/verifyState\(b\.state, secret\)/.test(API), '토큰 교환 전에 state 검증');
ok(!/PINTEREST_PUBLISH_PAUSED|pinterest_pin_log/.test(API), '실서비스 발행 스위치·기록을 건드리지 않는다');

console.log('\n[5] 화면 (녹화용 세 장면)');
ok(/Connect Pinterest/.test(PAGE) && /Create Pin/.test(PAGE) && /View Pin on Pinterest/.test(PAGE), '버튼 3개: 연결 · 핀 만들기 · 핀터레스트에서 보기');
ok(/Response · HTTP/.test(PAGE) && /Request/.test(PAGE), '요청과 응답을 화면에 보여준다');
ok(/never displayed/.test(PAGE) && !/innerHTML/.test(PAGE), '토큰 비표시 · 동적 값은 textContent 로만');
ok((VJ.rewrites || []).some((r) => r.source === '/pinterest-demo' && r.destination === '/pinterest-demo.html'), '/pinterest-demo 경로 연결');

console.log('\n[6] 흐름 실행 (가짜 핀터레스트·DB)');
(async function () {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) {
    if (/_lib\/auth$/.test(req)) return { requireAdmin: async () => ({ id: 'admin' }) };
    if (/_lib\/supabase$/.test(req)) return { supabaseAdmin: { from: () => {
      const q = { select: () => q, eq: () => q, not: () => q, order: () => q,
        limit: async () => ({ data: [{ slug: 'echo-form', title: 'Echo Form', cover_image: 'https://img.test/c.jpg', issue: 'No.9' }], error: null }) };
      return q; } } };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve(path.join(ROOT, 'api/admin/pinterest-demo.js'))];
  const handler = require(path.join(ROOT, 'api/admin/pinterest-demo.js'));
  Module._load = orig;
  process.env.PINTEREST_APP_SECRET = 'sec'; process.env.PINTEREST_SANDBOX_TOKEN = 'sbx';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    const J = (status, body) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(8) });
    if (/img\.test/.test(url)) return J(200, {});
    if (/oauth\/token/.test(url)) return J(200, { access_token: 'SECRET_TOKEN_123', token_type: 'bearer', scope: 'boards:read,pins:write', expires_in: 2592000 });
    if (/user_account/.test(url)) return J(200, { username: 'pap_magazine' });
    if (/sandbox.*\/boards\?/.test(url)) return J(200, { items: [] });
    if (/sandbox.*\/boards$/.test(url)) return J(201, { id: 'BRD', name: D.DEMO_BOARD_NAME });
    if (/sandbox.*\/pins$/.test(url)) return J(201, { id: '999', board_id: 'BRD', title: 'Echo Form', link: 'x' });
    return J(404, {});
  };
  const run = async (step, method, body) => {
    let code = 0, out = null;
    const res = { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; } };
    await handler({ method, query: { step }, body, headers: {} }, res);
    return { code, out };
  };
  const a = await run('authorize', 'GET');
  const state = new URL(a.out.url).searchParams.get('state');
  const bad = await run('exchange', 'POST', { code: 'c', state: '1.abc' });
  ok(bad.code === 400, '위조 state 는 토큰 교환 거부');
  const ex = await run('exchange', 'POST', { code: 'c', state });
  ok(ex.code === 200 && ex.out.username === 'pap_magazine' && ex.out.connected, '연결 성공 + 계정 이름');
  ok(JSON.stringify(ex.out).indexOf('SECRET_TOKEN_123') === -1, '응답에 액세스 토큰이 없다');
  const tokCall = calls.find((c) => /oauth\/token/.test(c.url));
  ok(tokCall && /redirect_uri=https%3A%2F%2Fwww\.pap-magazine\.com%2Fpinterest-demo/.test(tokCall.opts.body), '교환 때 같은 redirect_uri');
  const pin = await run('pin', 'POST', {});
  ok(pin.code === 200 && pin.out.pin_url === 'https://www.pinterest.com/pin/999/', '핀 생성 → 핀 URL');
  ok(pin.out.request.url === D.SANDBOX_API + '/pins' && pin.out.response.status === 201, '요청 주소·응답 코드가 화면용으로 돌아온다');
  ok(!calls.some((c) => /api\.pinterest\.com\/v5\/(pins|boards)/.test(c.url)), '실서버 핀·보드 API 호출 0회');
  console.log('\npinterest-demo: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch((e) => { console.log('  ✗ 실행 오류 ' + e.message); process.exit(1); });
