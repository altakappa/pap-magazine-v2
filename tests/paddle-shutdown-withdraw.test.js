/**
 * 2026-08-12 — Paddle 폐쇄(8/14) 이후에도 회원이 탈퇴할 수 있어야 한다.
 *
 * 무엇이 문제였나 — 실측
 *   subscriptions 에 paddle_subscription_id 가 있고 status 가 살아 있는 행 6건.
 *   cancelProviderSubscription 은 그 회원의 탈퇴 요청마다 api.paddle.com 을
 *   호출하고, 실패하면 { ok:false } 를 돌려준다. 호출부(api/auth/withdraw.js,
 *   api/admin/member-delete.js)는 계약대로 삭제를 중단한다.
 *   → 8/14 에 Paddle 계정이 닫히면 그 6명은 **탈퇴 자체가 영원히 실패한다.**
 *     개인정보 파기 의무를 우리 코드가 막는 셈이다.
 *
 *   원래 계약("해지 실패 시 삭제 금지")에는 전제가 있었다 — "해지에 실패하면
 *   돈이 계속 나간다". Paddle 이 사라지면 청구할 주체가 없어 그 전제가 무너진다.
 *   PayPal 쪽은 계속 청구되므로 계약을 그대로 둔다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MOD = path.join(ROOT, 'api/_lib/cancelProviderSubscription.js');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

// 텔레그램 스텁 — 실제로 아무 데도 보내지 않는다.
const telPath = require.resolve(path.join(ROOT, 'api/_lib/telegram.js'));
const sent = [];
require.cache[telPath] = {
  id: telPath, filename: telPath, loaded: true,
  exports: { sendTextToTelegramSafe: (t) => { sent.push(t); return Promise.resolve(); } },
};

function db(row, onUpdate) {
  return {
    from() {
      const q = {
        select() { return q; },
        eq() { return q; },
        maybeSingle() { return Promise.resolve({ data: row, error: null }); },
        update(patch) { if (onUpdate) onUpdate(patch); return { eq: () => Promise.resolve({ error: null }) }; },
      };
      return q;
    },
  };
}

// fetch 가 불리면 기록한다 — Paddle 을 실제로 부르는지 보기 위해서다.
const hits = [];
global.fetch = async (url) => {
  hits.push(String(url));
  return { ok: false, status: 500, json: async () => ({ error: { detail: 'account closed' } }) };
};

function load() {
  delete require.cache[require.resolve(MOD)];
  return require(MOD).cancelProviderSubscription;
}

(async () => {
  console.log('=== 소스 ===');
  {
    const src = fs.readFileSync(MOD, 'utf8');
    ok('폐쇄 시점이 코드에 박혀 있다 (env 를 잊어도 동작한다)', /PADDLE_SHUTDOWN_AT\s*=\s*Date\.UTC\(2026, 7, 14/.test(src));
    ok('env 로 앞당길 수 있다', /process\.env\.PADDLE_SHUTDOWN/.test(src));
    ok('PayPal 분기에는 예외가 없다 (그쪽은 계속 청구된다)',
      !/paddleIsGone\(\)[\s\S]{0,200}paypal_subscription_id/.test(src));
  }

  console.log('=== 폐쇄 전 — 기존 계약 그대로 (해지 실패 = 탈퇴 중단) ===');
  {
    process.env.PADDLE_SHUTDOWN = '';
    process.env.PADDLE_API_KEY = 'k';
    const orig = Date.now;
    Date.now = () => Date.UTC(2026, 7, 13, 0, 0, 0); // 8/13
    hits.length = 0;
    const fn = load();
    const r = await fn(db({ paddle_subscription_id: 'sub_1', status: 'active', provider: 'paddle' }), 'U1');
    Date.now = orig;
    ok('Paddle 을 실제로 부른다', hits.some((h) => h.indexOf('paddle.com') !== -1));
    ok('실패하면 ok:false — 탈퇴를 막는다', r.ok === false && r.action === 'failed',
      '폐쇄 전에는 일시적 장애일 수 있다. 돈이 계속 나가는 쪽이 더 위험하다');
  }

  console.log('=== 폐쇄 후 — 탈퇴를 통과시킨다 ===');
  {
    process.env.PADDLE_SHUTDOWN = '';
    const orig = Date.now;
    Date.now = () => Date.UTC(2026, 7, 15, 0, 0, 0); // 8/15
    hits.length = 0; sent.length = 0;
    let updated = null;
    const fn = load();
    const r = await fn(db({ paddle_subscription_id: 'sub_1', status: 'active', provider: 'paddle' }, (p) => { updated = p; }), 'U1');
    Date.now = orig;
    ok('Paddle 을 부르지 않는다', !hits.some((h) => h.indexOf('paddle.com') !== -1),
      '부를 곳이 없다. 실패가 탈퇴를 막는 것이 유일한 결과다');
    ok('ok:true 로 탈퇴를 통과시킨다', r.ok === true && r.action === 'canceled');
    ok('우리 DB 상태를 canceled 로 표시한다', updated && updated.status === 'canceled');
    ok('건너뛴 사실을 텔레그램으로 알린다', sent.some((t) => t.indexOf('Paddle') !== -1 && t.indexOf('U1') !== -1),
      '조용히 넘기면 진짜로 살아 있는 구독을 놓친다');
  }

  console.log('=== 폐쇄 후에도 PayPal 은 그대로 막는다 ===');
  {
    const orig = Date.now;
    Date.now = () => Date.UTC(2026, 7, 15, 0, 0, 0);
    process.env.PAYPAL_CLIENT_ID = 'x'; process.env.PAYPAL_CLIENT_SECRET = 'y';
    hits.length = 0;
    const fn = load();
    const r = await fn(db({ paypal_subscription_id: 'I-1', status: 'active', provider: 'paypal' }), 'U2');
    Date.now = orig;
    ok('PayPal 해지 실패는 여전히 ok:false', r.ok === false,
      'PayPal 은 살아 있다 — 못 끊으면 돈이 계속 나간다');
  }

  console.log('=== env 로 앞당길 수 있다 ===');
  {
    process.env.PADDLE_SHUTDOWN = '1';
    const orig = Date.now;
    Date.now = () => Date.UTC(2026, 7, 12, 0, 0, 0); // 8/12
    hits.length = 0;
    const fn = load();
    const r = await fn(db({ paddle_subscription_id: 'sub_1', status: 'active', provider: 'paddle' }), 'U3');
    Date.now = orig;
    process.env.PADDLE_SHUTDOWN = '';
    ok('PADDLE_SHUTDOWN=1 이면 날짜 전에도 건너뛴다', r.ok === true && !hits.some((h) => h.indexOf('paddle.com') !== -1));
  }

  console.log('=== 호출부 계약이 그대로인지 ===');
  {
    const w = fs.readFileSync(path.join(ROOT, 'api/auth/withdraw.js'), 'utf8');
    const d = fs.readFileSync(path.join(ROOT, 'api/admin/member-delete.js'), 'utf8');
    ok('withdraw 는 여전히 실패 시 중단한다', /if \(!cancelRes\.ok\)/.test(w));
    ok('member-delete 도 cancelProviderSubscription 을 먼저 부른다', /cancelProviderSubscription\(/.test(d));
  }

  console.log('\n=== SUMMARY ===');
  if (fails.length) {
    console.error('passed: ' + pass + '   failed: ' + fails.length);
    fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
    process.exit(1);
  }
  console.log('passed: ' + pass + '   failed: 0');
  console.log('✓ paddle-shutdown-withdraw tests passed');
  process.exit(0);
})();
