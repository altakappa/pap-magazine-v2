/**
 * 2026-08-12 — 서브미션 게재료 결제가 두 번 청구되지 않게 고정한다.
 *
 * 무엇이 문제였나
 *   예전 paypal-capture.js 는 capture(= 실제 돈 인출)가 파일의 첫 부수효과였다.
 *   소유자 확인 · 금액 확인 · 서브미션 조회 · "이미 결제됨" 확인이 전부 그 뒤에
 *   있었고, 실패 갈래 9개 중 8개는 조용히 4xx/5xx 만 뱉었다(텔레그램도 없었다).
 *   회원 화면에는 "잠시 후 다시 시도해 주세요" 가 떴고, 다시 누르면
 *   paypal-order.js 가 새 주문을 발급해 **진짜로 두 번 청구**됐다.
 *   payment_status 검사는 첫 결제가 DB 에 안 적힌 상태라 통과해 버렸다.
 *
 *   €790 짜리다. 한 번 새면 한 달 구독 매출보다 크다.
 *
 * 여기서 지키는 것
 *   [A] 검증이 전부 캡처보다 앞에 있다 (소스 순서)
 *   [B] 실제로 실행해서 — 막아야 할 상황에서 capture 가 호출되지 않는다
 *   [C] 캡처 뒤 실패는 전부 알림 + code:'paid_but_unconfirmed'
 *   [D] 서버측 멱등키(PayPal-Request-Id)로 재시도가 새 주문을 만들지 않는다
 *   [E] 회원 화면이 캡처 실패에 "다시 시도" 를 말하지 않는다
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

// ── [A] 소스 순서 — 검증이 캡처보다 앞에 있다 ──────────────────────────
console.log('=== [A] 돈이 움직이기 전에 전부 확인한다 ===');
{
  const src = read('api/submissions/paypal-capture.js');
  const at = (re) => { const m = src.match(re); return m ? src.indexOf(m[0]) : -1; };

  const capture = at(/orders\/\$\{encodeURIComponent\(orderId\)\}\/capture/);
  const getOrder = at(/const ord = await paypalFetch/);
  const owner = at(/Not your submission/);
  const price = at(/amount_mismatch/);
  const alreadyPaid = at(/code: 'already_paid'/);
  const status = at(/code: 'not_approved'/);

  ok('캡처 호출을 찾았다', capture > 0);
  ok('주문 GET 이 캡처보다 먼저다', getOrder > 0 && getOrder < capture);
  ok('소유자 확인이 캡처보다 먼저다', owner > 0 && owner < capture,
    '뒤에 있으면 남의 서브미션에 돈이 먼저 나간다');
  ok('금액 확인이 캡처보다 먼저다', price > 0 && price < capture,
    '뒤에 있으면 위조 금액이 먼저 결제된다');
  ok('"이미 결제됨" 확인이 캡처보다 먼저다', alreadyPaid > 0 && alreadyPaid < capture,
    '이게 이중청구를 막는 결정적 지점이다');
  ok('주문 상태 확인이 캡처보다 먼저다', status > 0 && status < capture);
}

// ── [C] 캡처 뒤 실패는 전부 알림 + paid_but_unconfirmed ─────────────────
console.log('=== [C] 돈을 받은 뒤의 실패는 조용히 넘어가지 않는다 ===');
{
  const src = read('api/submissions/paypal-capture.js');
  const after = src.slice(src.indexOf('/capture'));
  const stuckCount = (after.match(/paid_but_unconfirmed/g) || []).length;
  ok('캡처 이후 구간에 paid_but_unconfirmed 가 3곳 이상 있다', stuckCount >= 3, '실제 ' + stuckCount + '곳');
  ok('알림 함수가 있다', /async function alertStuck/.test(src));
  ok('알림을 await 한다 (서버리스에서 유실되지 않게)', /await alertStuck\(/.test(src),
    '띄워만 두면 응답 반환 후 함수가 얼어 알림이 사라진다');
  ok('DB 반영 실패에 알림이 붙어 있다', /DB 반영 실패[\s\S]{0,200}paid_but_unconfirmed/.test(src));
  ok('애드온 기록 실패의 error 를 검사한다', /const \{ error: aErr \}/.test(src),
    '예전에는 await 만 하고 반환값을 안 봐서, 실패해도 ok:true 를 돌려줬다');
  ok('catch 도 재시도를 권하지 않는다', /catch[\s\S]{0,600}Do not pay again/.test(src));
}

// ── [D] 서버측 멱등키 ──────────────────────────────────────────────────
console.log('=== [D] 재시도가 새 주문을 만들지 않는다 ===');
{
  const src = read('api/submissions/paypal-order.js');
  ok('PayPal-Request-Id 를 보낸다', /'PayPal-Request-Id': requestId/.test(src));
  ok('멱등키가 서브미션·종류·애드온으로 결정된다', /\['pap', kind, submissionId, addon \|\| 'base'/.test(src));
  ok('시간 버킷이 들어 있다 (애드온 재구매를 영구 차단하지 않는다)', /bucket/.test(src));
}

// ── [E] 회원 화면 문구 ─────────────────────────────────────────────────
console.log('=== [E] 캡처 실패에 "다시 시도" 를 말하지 않는다 ===');
{
  const src = read('frontend/pap-submission-fee.js');
  const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
  const vals = [];
  const re = /payCaptureUnconfirmed:'((?:[^'\\]|\\.)*)'/g;
  let m; while ((m = re.exec(src))) vals.push(m[1]);
  ok('9개 언어에 캡처 실패 전용 문구가 있다', vals.length === LANGS.length, '실제 ' + vals.length + '개');
  ok('전부 "다시 결제하지 말라" 는 취지를 담고 있다',
    vals.every((v) => /다시 결제하지|do not pay again|nicht erneut|Non pagare di nuovo|pas une seconde fois|No vuelva a pagar|重ねてのお支払い|不要重复支付|не платите повторно/i.test(v)),
    '"다시 시도" 를 권하면 두 번째 주문이 발급된다');
  ok('전부 연락처를 준다', vals.every((v) => v.indexOf('contact@pap-magazine.com') !== -1));

  ok('재시도 안전 여부를 서버 code 로 가른다', /safeToRetry/.test(src));
  ok('돈이 안 나간 code 만 재시도를 권한다',
    /capture_failed[\s\S]{0,80}order_lookup_failed[\s\S]{0,80}not_approved/.test(src));
  ok('네트워크 예외도 재시도를 권하지 않는다',
    /catch\(function\(\)\{[\s\S]{0,200}payCaptureUnconfirmed/.test(src));
  ok('already_paid 면 이미 결제됨으로 안내하고 버튼을 잠근다',
    /already_paid'\)\{[\s\S]{0,200}_lockBaseFeeButton/.test(src));
}

// ── [B] 실행 — 막아야 할 상황에서 capture 가 호출되지 않는다 ────────────
console.log('=== [B] 실제로 실행 — capture 가 언제 불리는가 ===');

function loadHandler(stubs) {
  const p = (rel) => require.resolve(path.join(ROOT, rel));
  const set = (rel, exports) => { require.cache[p(rel)] = { id: p(rel), filename: p(rel), loaded: true, exports }; };
  set('api/_lib/auth.js', { requireAuth: () => stubs.user });
  set('api/_lib/cors.js', { handleCors: () => false });
  set('api/_lib/rateLimit.js', { rateLimit: () => false, RATE_LIMITS: { auth: {} } });
  set('api/_lib/telegram.js', { sendTextToTelegramSafe: (t) => { stubs.telegram.push(t); return Promise.resolve(); } });
  set('api/_lib/supabase.js', { supabaseAdmin: stubs.supabase });
  set('api/_lib/paypalOrders.js', {
    paypalFetch: stubs.paypalFetch,
    resolveAmount: () => ({ cents: 79000, label: 'branded' }),
    centsToValue: (c) => (Number(c) / 100).toFixed(2),
    parseCustomId: () => ({ kind: 'submission_fee', submissionId: 'SUB1', addon: null }),
  });
  delete require.cache[p('api/submissions/paypal-capture.js')];
  return require(p('api/submissions/paypal-capture.js'));
}

function makeSupabase(row, updateError) {
  const calls = { updates: [] };
  return {
    calls,
    from() {
      const q = {
        select() { return q; },
        eq() { return q; },
        maybeSingle() { return Promise.resolve({ data: row, error: null }); },
        update(patch) { calls.updates.push(patch); return { eq: () => Promise.resolve({ error: updateError || null }) }; },
      };
      return q;
    },
  };
}

function makeRes() {
  const out = { code: 0, body: null };
  return {
    out,
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; },
  };
}

// 주문 GET 응답을 만드는 헬퍼 (기본: 승인됨 · €790)
function orderBody(over) {
  return Object.assign({
    status: 'APPROVED',
    purchase_units: [{ custom_id: 'x', amount: { currency_code: 'EUR', value: '790.00' } }],
  }, over || {});
}
function capturedBody() {
  return {
    status: 'COMPLETED',
    purchase_units: [{
      custom_id: 'x', amount: { currency_code: 'EUR', value: '790.00' },
      payments: { captures: [{ status: 'COMPLETED', amount: { currency_code: 'EUR', value: '790.00' } }] },
    }],
  };
}

async function run(scenario) {
  const seen = [];
  const stubs = {
    user: scenario.user || { id: 'U1' },
    telegram: [],
    supabase: scenario.supabase,
    paypalFetch: async (p, o) => {
      seen.push(((o && o.method) || 'GET') + ' ' + p);
      if (p.indexOf('/capture') !== -1) return { ok: true, status: 201, body: capturedBody() };
      return { ok: true, status: 200, body: scenario.order || orderBody() };
    },
  };
  const handler = loadHandler(stubs);
  const res = makeRes();
  await handler({ method: 'POST', body: { order_id: 'ORDER-NEW' } }, res);
  return { res: res.out, captured: seen.some((c) => c.indexOf('/capture') !== -1), calls: seen, telegram: stubs.telegram, updates: scenario.supabase.calls.updates };
}

(async () => {
  {
    // 이미 결제된 건에 새 주문이 승인돼 들어왔다 → 캡처하면 안 된다
    const r = await run({ supabase: makeSupabase({ id: 'SUB1', user_id: 'U1', payment_status: 'paid', paypal_order_id: 'ORDER-OLD' }) });
    ok('이미 결제된 건이면 캡처하지 않는다', r.captured === false, '이게 이중청구를 막는 지점이다');
    ok('  → 409 already_paid 로 답한다', r.res.code === 409 && r.res.body.code === 'already_paid');
    ok('  → 회원에게 "추가 청구 없음" 을 말한다', /not been charged again/i.test(r.res.body.message));
    ok('  → 운영자에게 void 하라고 알린다', r.telegram.some((t) => t.indexOf('void') !== -1));
  }
  {
    // 같은 주문을 다시 보냈다(네트워크 재시도) → 정상 응답
    const r = await run({ supabase: makeSupabase({ id: 'SUB1', user_id: 'U1', payment_status: 'paid', paypal_order_id: 'ORDER-NEW' }) });
    ok('같은 주문 재전송은 duplicate 로 조용히 성공', r.captured === false && r.res.code === 200 && r.res.body.outcome === 'duplicate');
  }
  {
    // 남의 서브미션
    const r = await run({ supabase: makeSupabase({ id: 'SUB1', user_id: 'OTHER', payment_status: 'awaiting_payment' }) });
    ok('남의 서브미션이면 캡처하지 않는다', r.captured === false && r.res.code === 403);
  }
  {
    // 주문 금액이 서버 산출가와 다르다
    const r = await run({
      supabase: makeSupabase({ id: 'SUB1', user_id: 'U1', payment_status: 'awaiting_payment' }),
      order: orderBody({ purchase_units: [{ custom_id: 'x', amount: { currency_code: 'EUR', value: '1.00' } }] }),
    });
    ok('금액이 다르면 캡처하지 않는다', r.captured === false && r.res.code === 409 && r.res.body.code === 'amount_mismatch');
    ok('  → 알림이 나간다', r.telegram.length > 0);
  }
  {
    // 승인되지 않은 주문
    const r = await run({
      supabase: makeSupabase({ id: 'SUB1', user_id: 'U1', payment_status: 'awaiting_payment' }),
      order: orderBody({ status: 'CREATED' }),
    });
    ok('승인 전 주문이면 캡처하지 않는다', r.captured === false && r.res.code === 409 && r.res.body.code === 'not_approved');
  }
  {
    // 정상
    const r = await run({ supabase: makeSupabase({ id: 'SUB1', user_id: 'U1', payment_status: 'awaiting_payment' }) });
    ok('정상 건은 캡처하고 200 paid 를 준다', r.captured === true && r.res.code === 200 && r.res.body.outcome === 'paid');
    ok('  → payment_status 를 paid 로 쓴다', r.updates.some((u) => u.payment_status === 'paid'));
    ok('  → 금액과 주문 ID 를 남긴다', r.updates.some((u) => u.paid_amount === 79000 && u.paypal_order_id === 'ORDER-NEW'));
    ok('  → 결제사를 남긴다', r.updates.some((u) => u.payment_provider === 'paypal'));
    ok('  → 캡처는 정확히 한 번', r.calls.filter((c) => c.indexOf('/capture') !== -1).length === 1);
  }
  {
    // 돈은 받았는데 DB 반영 실패 — 제일 위험한 상태
    const r = await run({ supabase: makeSupabase({ id: 'SUB1', user_id: 'U1', payment_status: 'awaiting_payment' }, { message: 'connection reset' }) });
    ok('DB 반영이 실패하면 paid_but_unconfirmed 를 준다',
      r.res.code === 500 && r.res.body.code === 'paid_but_unconfirmed');
    ok('  → 회원에게 다시 결제하지 말라고 한다', /Do not pay again/i.test(r.res.body.message));
    ok('  → 운영자에게 수동 처리하라고 알린다',
      r.telegram.some((t) => t.indexOf('DB 반영 실패') !== -1 && t.indexOf('SUB1') !== -1),
      '알림이 없으면 돈을 받은 사실 자체를 아무도 모른다');
  }

  console.log('\n=== SUMMARY ===');
  if (fails.length) {
    console.error('passed: ' + pass + '   failed: ' + fails.length);
    fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
    process.exit(1);
  }
  console.log('passed: ' + pass + '   failed: 0');
  console.log('✓ paypal-capture-no-double-charge tests passed');
  process.exit(0);
})();
