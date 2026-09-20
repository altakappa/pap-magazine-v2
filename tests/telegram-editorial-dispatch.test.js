'use strict';
/**
 * 발행 텔레그램 전송의 워커 분리 (2026-09-20 사고: 발행 PUT 120초 상한 → 504, 캡션·승인메일 유실)
 *
 *  1. telegram.mapPool: 순서 보존 + 동시 실행 상한 (실행)
 *  2. [id].js dispatchTelegramEditorial: waitUntil 있으면 응답 안 막고 워커를 부른다 / 없으면 9초 대기 /
 *     깨우기 실패면 직접 전송 (실행 — 원문에서 함수를 꺼내 가짜 fetch·require 로 돌린다)
 *  3. 워커 api/editorials/telegram-send.js: CRON_SECRET 없으면 관리자 확인, 발행 안 된 화보는 409 (실행 — require 캐시 스텁)
 *  4. vercel.json: 워커에 maxDuration 300 (정확한 파일명 키), [id] 글롭 키 없음
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

(async () => {
  console.log('=== 1. mapPool ===');
  {
    const { mapPool } = require('../api/_lib/telegram');
    let running = 0, peak = 0;
    const out = await mapPool([50, 10, 30, 5, 20, 1], 3, async (ms, i) => {
      running++; peak = Math.max(peak, running);
      await tick(ms); running--;
      return i * 10;
    });
    t('순서 보존 (느린 것이 먼저여도 자리 유지)', JSON.stringify(out) === JSON.stringify([0, 10, 20, 30, 40, 50]), JSON.stringify(out));
    t('동시 실행 상한 3', peak === 3, 'peak ' + peak);
    t('빈 배열 → 빈 배열', (await mapPool([], 3, async () => 1)).length === 0);
  }

  console.log('\n=== 2. dispatchTelegramEditorial ([id].js 원문 실행) ===');
  const idSrc = R('api/editorials/[id].js');
  const m = idSrc.match(/const TG_WORKER_URL = [\s\S]*?\nasync function dispatchTelegramEditorial\(ed\) \{[\s\S]*?\n\}\n/);
  t('원문에서 헬퍼 블록 추출', !!m);
  function build(opts) {
    const calls = [];
    const wu = [];
    const ctx = {
      console: { warn() {}, log() {} },
      process: { env: Object.assign({ CRON_SECRET: 'sek' }, opts.env || {}) },
      fetch: (url, o) => { calls.push({ url, o }); return opts.fetchImpl ? opts.fetchImpl(url, o) : Promise.resolve({ ok: true, status: 200 }); },
      require: (n) => { if (n === '@vercel/functions') { if (opts.noWaitUntil) throw new Error('no'); return { waitUntil: (p) => wu.push(p) }; } throw new Error('unexpected require ' + n); },
      sendEditorialToTelegramSafe: async (ed) => { calls.push({ inline: ed.id }); return { sent: 1 }; },
      AbortSignal, Error,
    };
    vm.createContext(ctx);
    vm.runInContext(m[0] + '\nthis.dispatchTelegramEditorial = dispatchTelegramEditorial;', ctx);
    return { fn: ctx.dispatchTelegramEditorial, calls, wu };
  }
  {
    const { fn, calls, wu } = build({});
    const r = await fn({ id: 'abc-1' });
    t('waitUntil 있음: 즉시 { dispatched: waitUntil }, 워커 GET 을 Bearer CRON_SECRET 으로 호출', r.dispatched === 'waitUntil' && calls.length === 1 && /\/api\/editorials\/telegram-send\?id=abc-1$/.test(calls[0].url) && calls[0].o.headers.Authorization === 'Bearer sek' && wu.length === 1, JSON.stringify({ r, calls }));
    t('직접 전송(inline)은 하지 않는다', !calls.some((c) => c.inline));
  }
  {
    const { fn, calls } = build({ noWaitUntil: true });
    const r = await fn({ id: 'abc-2' });
    t('waitUntil 없음: 워커 응답을 기다리고 { dispatched: await }', r.dispatched === 'await' && calls.length === 1 && !calls.some((c) => c.inline));
  }
  {
    const { fn, calls } = build({ noWaitUntil: true, fetchImpl: () => { const e = new Error('t'); e.name = 'TimeoutError'; return Promise.reject(e); } });
    const r = await fn({ id: 'abc-3' });
    t('waitUntil 없음 + 9초 초과: 워커는 이미 돌고 있으므로 직접 전송하지 않는다', r.dispatched === 'await-timeout' && !calls.some((c) => c.inline));
  }
  {
    const { fn, calls } = build({ noWaitUntil: true, fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')) });
    const r = await fn({ id: 'abc-4' });
    t('깨우기 실패(네트워크): 종전처럼 이 함수에서 직접 전송 (안전망)', r.dispatched === 'inline-fallback' && calls.some((c) => c.inline === 'abc-4'));
  }
  {
    const { fn, calls } = build({ env: { CRON_SECRET: '' } });
    const r = await fn({ id: 'abc-5' });
    t('CRON_SECRET 없음: 직접 전송', r.dispatched === 'inline' && calls.some((c) => c.inline === 'abc-5') && !calls.some((c) => c.url));
  }
  t('발행 전환 시 dispatchTelegramEditorial 을 await 한다 (직접 sendEditorialToTelegramSafe 아님)', /if \(becomingPublished\) \{[\s\S]{0,600}await dispatchTelegramEditorial\(data\);/.test(idSrc) && !/if \(becomingPublished\) \{[\s\S]{0,600}await sendEditorialToTelegramSafe\(data\)/.test(idSrc));

  console.log('\n=== 3. 워커 api/editorials/telegram-send.js (require 스텁) ===');
  {
    const Module = require('module');
    const stubs = {
      '../_lib/supabase': { supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: global.__row, error: null }) }) }) }) } },
      '../_lib/cors': { handleCors: () => false },
      '../_lib/secretCompare': { safeEqual: (a, b) => a === b },
      '../_lib/auth': { requireAdmin: async (req, res) => { if (req.headers['x-admin']) return { id: 'u', email: 'a@b' }; res.status(403).json({ message: 'Admin access required' }); return null; } },
      '../_lib/telegram': { sendEditorialToTelegramSafe: async (ed) => { global.__sent = ed.id; return { sent: 3, captionSent: true }; } },
    };
    const orig = Module.prototype.require;
    Module.prototype.require = function (n) { if (Object.prototype.hasOwnProperty.call(stubs, n)) return stubs[n]; return orig.apply(this, arguments); };
    delete require.cache[require.resolve('../api/editorials/telegram-send.js')];
    const handler = require('../api/editorials/telegram-send.js');
    Module.prototype.require = orig;
    function res() { const o = { code: 0, body: null, status(c) { o.code = c; return o; }, json(b) { o.body = b; return o; } }; return o; }
    process.env.CRON_SECRET = 'sek';
    global.__row = { id: '11111111-1111-1111-1111-111111111111', title: 'T', status: 'published' };
    let r = res(); global.__sent = null;
    await handler({ method: 'GET', headers: { authorization: 'Bearer sek' }, query: { id: global.__row.id } }, r);
    t('Bearer CRON_SECRET + 발행됨 → 전송하고 200', r.code === 200 && r.body && r.body.ok === true && global.__sent === global.__row.id, JSON.stringify(r.body));
    r = res(); global.__sent = null;
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' }, query: { id: global.__row.id } }, r);
    t('잘못된 시크릿 + 관리자 아님 → 403, 전송 안 함', r.code === 403 && global.__sent === null);
    r = res(); global.__sent = null;
    await handler({ method: 'GET', headers: { 'x-admin': '1' }, query: { id: global.__row.id } }, r);
    t('관리자 세션(수동 재전송) → 200', r.code === 200 && global.__sent === global.__row.id);
    global.__row = { id: '11111111-1111-1111-1111-111111111111', title: 'T', status: 'draft' };
    r = res(); global.__sent = null;
    await handler({ method: 'GET', headers: { authorization: 'Bearer sek' }, query: { id: global.__row.id } }, r);
    t('초안이면 409, 전송 안 함', r.code === 409 && global.__sent === null);
    r = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer sek' }, query: { id: 'nope' } }, r);
    t('id 형식이 아니면 400', r.code === 400);
    delete process.env.CRON_SECRET; delete global.__row; delete global.__sent;
  }

  console.log('\n=== 4. vercel.json ===');
  {
    const v = JSON.parse(R('vercel.json'));
    const f = v.functions || {};
    t('워커 maxDuration 300 (정확한 파일명 키)', f['api/editorials/telegram-send.js'] && f['api/editorials/telegram-send.js'].maxDuration === 300);
    t('[id] 가 든 글롭 키는 없다 (minimatch 가 문자 클래스로 읽어 아무것도 안 맞는다 → 빌드 실패)', !Object.keys(f).some((k) => /\[/.test(k)));
    t('와일드카드 api/**/*.js 는 그대로 120', f['api/**/*.js'] && f['api/**/*.js'].maxDuration === 120);
    t('워커는 크론 스케줄에 없다 (온디맨드)', !(v.crons || []).some((c) => /telegram-send/.test(c.path)));
  }

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ telegram-editorial-dispatch FAILED'); process.exit(1); }
  console.log('✅ telegram-editorial-dispatch passed');
})();
