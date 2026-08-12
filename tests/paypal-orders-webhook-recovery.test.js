/**
 * 2026-08-12 — 서브미션 결제의 "복구 그물" 을 고정한다.
 *
 * ■ 왜
 *   구독 웹훅은 500 을 던지면 PayPal 이 재시도해 자동 복구된다. 그런데 서브미션
 *   게재료(€380/€790)·애드온(€110/€220)은 브라우저→서버 왕복 한 번이 전부였다.
 *   그 한 번이 실패하면 돈은 받았는데 DB 는 안 바뀌고 되돌릴 방법이 없었다.
 *   PAYMENT.CAPTURE.COMPLETED 하나를 받는 것만으로 그 갈래가 전부 자동 복구된다.
 *
 *   환불도 없었다. PayPal 대시보드에서 직접 환불하면 payment_status 는 영원히
 *   'paid' 로 남아, 환불된 건이 게재 대기열에 계속 선다.
 *
 * ■ 이 코드는 평소엔 아무 일도 하지 않아야 한다
 *   paypal-capture.js 가 먼저 반영했으면 "이미 반영됨" 으로 조용히 끝나야 한다.
 *   그래서 멱등성이 이 테스트의 절반이다.
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

// 텔레그램 스텁
const telPath = require.resolve(path.join(ROOT, 'api/_lib/telegram.js'));
const sent = [];
require.cache[telPath] = {
  id: telPath, filename: telPath, loaded: true,
  exports: { sendTextToTelegramSafe: (t) => { sent.push(t); return Promise.resolve(); } },
};

const { handleCaptureCompleted, handleCaptureRefunded, captureOrderId } =
  require(path.join(ROOT, 'api/_lib/paypalCaptureRecovery.js'));

// 아주 작은 supabase 스텁 — .eq() 로 건 조건을 기억해 행을 골라 준다.
function makeDb(rows) {
  const state = { updates: [] };
  const db = {
    state,
    from() {
      const filt = {};
      const q = {
        select() { return q; },
        eq(col, val) { filt[col] = val; return q; },
        maybeSingle() {
          const hit = rows.find((r) => Object.keys(filt).every((k) => String(r[k]) === String(filt[k])));
          return Promise.resolve({ data: hit || null, error: null });
        },
        update(patch) {
          return {
            eq(col, val) {
              const hit = rows.find((r) => String(r[col]) === String(val));
              if (hit) { Object.assign(hit, patch); state.updates.push({ id: hit.id, patch }); }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return q;
    },
  };
  return db;
}

const capture = (over) => Object.assign({
  id: 'CAP1',
  custom_id: 'f|SUB1',
  amount: { currency_code: 'EUR', value: '790.00' },
  supplementary_data: { related_ids: { order_id: 'ORDER1' } },
}, over || {});

(async () => {
  console.log('=== 주문 ID 추출 ===');
  ok('supplementary_data 의 order_id 를 쓴다', captureOrderId(capture()) === 'ORDER1');
  ok('없으면 캡처 ID 로 대체한다', captureOrderId({ id: 'CAP9' }) === 'CAP9');

  console.log('=== 게재료 — 브라우저 확정이 실패한 건을 메운다 ===');
  {
    sent.length = 0;
    const rows = [{ id: 'SUB1', payment_status: 'awaiting_payment', paypal_order_id: null, admin_notes: null }];
    const db = makeDb(rows);
    const r = await handleCaptureCompleted(db, capture());
    ok('payment_status 를 paid 로 바꾼다', rows[0].payment_status === 'paid' && r.recovered === 'submission_fee');
    ok('  → 금액을 유로센트로 남긴다', rows[0].paid_amount === 79000);
    ok('  → 주문 ID 와 결제사를 남긴다', rows[0].paypal_order_id === 'ORDER1' && rows[0].payment_provider === 'paypal');
    ok('  → 복구했다는 사실을 알린다', sent.some((t) => t.indexOf('웹훅 복구') !== -1 && t.indexOf('SUB1') !== -1),
      '조용히 고치면 브라우저 경로가 고장 난 줄 모른다');
  }
  {
    // 이미 paypal-capture.js 가 반영한 정상 상황 — 아무 일도 하지 않아야 한다
    sent.length = 0;
    const rows = [{ id: 'SUB1', payment_status: 'paid', paypal_order_id: 'ORDER1', admin_notes: null }];
    const db = makeDb(rows);
    const r = await handleCaptureCompleted(db, capture());
    ok('이미 반영됐으면 아무것도 하지 않는다', r.already === true && db.state.updates.length === 0);
    ok('  → 알림도 안 보낸다 (정상 결제마다 텔레그램이 두 번 울리면 안 된다)', sent.length === 0);
  }
  {
    // 같은 이벤트가 두 번 와도 안전한가
    const rows = [{ id: 'SUB1', payment_status: 'awaiting_payment', paypal_order_id: null, admin_notes: null }];
    const db = makeDb(rows);
    await handleCaptureCompleted(db, capture());
    const before = db.state.updates.length;
    const r2 = await handleCaptureCompleted(db, capture());
    ok('같은 이벤트가 두 번 와도 한 번만 쓴다', r2.already === true && db.state.updates.length === before);
  }
  {
    sent.length = 0;
    const db = makeDb([]);
    const r = await handleCaptureCompleted(db, capture());
    ok('서브미션을 못 찾으면 알린다', r.unmatched === true && sent.some((t) => t.indexOf('못 찾음') !== -1),
      '조용히 넘기면 돈을 받은 사실 자체를 모른다');
  }
  {
    const db = makeDb([{ id: 'SUB1', payment_status: 'awaiting_payment' }]);
    const r = await handleCaptureCompleted(db, capture({ custom_id: '' }));
    ok('custom_id 가 없으면 손대지 않는다', r.ignored === 'no_custom_id');
  }

  console.log('=== 애드온 — 기록만 남긴다 ===');
  {
    sent.length = 0;
    const rows = [{ id: 'SUB1', payment_status: 'awaiting_payment', admin_notes: '심사 메모' }];
    const db = makeDb(rows);
    const r = await handleCaptureCompleted(db, capture({
      custom_id: 'a|SUB1|ig_images_cover',
      amount: { currency_code: 'EUR', value: '220.00' },
    }));
    ok('admin_notes 에 결제 줄을 덧붙인다', r.recovered === 'addon' && /PayPal 애드온 결제: ig_images_cover €220\.00/.test(rows[0].admin_notes));
    ok('  → 기존 메모를 지우지 않는다', rows[0].admin_notes.indexOf('심사 메모') !== -1);
    ok('  → payment_status 는 건드리지 않는다 (애드온은 기본료가 아니다)', rows[0].payment_status === 'awaiting_payment');
    // 같은 주문이 또 오면
    const before = rows[0].admin_notes;
    const r2 = await handleCaptureCompleted(db, capture({
      custom_id: 'a|SUB1|ig_images_cover',
      amount: { currency_code: 'EUR', value: '220.00' },
    }));
    ok('같은 주문이 또 와도 줄이 늘지 않는다', r2.already === true && rows[0].admin_notes === before);
  }

  console.log('=== 환불 ===');
  {
    sent.length = 0;
    const rows = [{ id: 'SUB1', payment_status: 'paid', paypal_order_id: 'ORDER1' }];
    const db = makeDb(rows);
    const r = await handleCaptureRefunded(db, {
      id: 'REF1', amount: { currency_code: 'EUR', value: '790.00' },
      supplementary_data: { related_ids: { order_id: 'ORDER1' } },
    }, 'PAYMENT.CAPTURE.REFUNDED');
    ok('custom_id 가 없어도 주문 ID 로 찾아낸다', r.refunded === true && rows[0].payment_status === 'refunded',
      '환불 이벤트에는 custom_id 가 없을 수 있다');
    ok('  → 게재 대기열 확인을 요청한다', sent.some((t) => t.indexOf('게재 대기열') !== -1));
  }
  {
    sent.length = 0;
    const rows = [{ id: 'SUB2', payment_status: 'paid', paypal_order_id: 'OTHER' }];
    const db = makeDb(rows);
    const r = await handleCaptureRefunded(db, {
      id: 'REF9', amount: { currency_code: 'EUR', value: '5.49' },
    }, 'PAYMENT.CAPTURE.REFUNDED');
    ok('못 찾으면 조용히 넘기지 않고 알린다', r.unmatched === true && sent.some((t) => t.indexOf('수동 확인') !== -1));
    ok('  → 엉뚱한 행을 건드리지 않는다', rows[0].payment_status === 'paid');
  }

  console.log('=== 웹훅 배선 ===');
  {
    const src = read('api/paypal-webhook.js');
    ok('PAYMENT.CAPTURE.COMPLETED 를 처리한다', /case 'PAYMENT\.CAPTURE\.COMPLETED'/.test(src));
    ok('PAYMENT.CAPTURE.REFUNDED / REVERSED 를 처리한다',
      /case 'PAYMENT\.CAPTURE\.REFUNDED'/.test(src) && /case 'PAYMENT\.CAPTURE\.REVERSED'/.test(src));
    ok('분쟁 이벤트를 알린다', /case 'CUSTOMER\.DISPUTE\.CREATED'/.test(src) && /해결 센터/.test(src));
    ok('복구 로직을 lib 에서 가져온다', /require\('\.\/_lib\/paypalCaptureRecovery'\)/.test(src));
  }

  console.log('=== 해지 강등이 plan 까지 내린다 ===');
  {
    const src = read('api/paypal-webhook.js');
    ok('downgradeToFree 를 쓴다', /downgradeToFree\(supabaseAdmin, userId\)/.test(src));
    ok('subscription_status 만 바꾸던 코드가 없다',
      !/\.update\(\{ subscription_status: 'inactive' \}\)/.test(src),
      '프론트 게이트는 plan 만 본다 — status 만 내리면 화면엔 PREMIUM 이 남는다');
    const acc = read('api/_lib/subscriptionAccess.js');
    ok('downgradeToFree 는 plan 과 status 를 모두 내린다',
      /subscription_plan: 'free'/.test(acc) && /subscription_status: 'inactive'/.test(acc));
  }

  console.log('=== 갱신 결제가 past_due 를 되돌린다 ===');
  {
    const src = read('api/paypal-webhook.js');
    ok('결제 성공 시 status 를 active 로 되돌린다',
      /patch\.status = 'active'/.test(src),
      '되돌리지 않으면 재시도 성공 후에도 어드민 연체 지표가 계속 틀린다');
  }

  console.log('\n=== SUMMARY ===');
  if (fails.length) {
    console.error('passed: ' + pass + '   failed: ' + fails.length);
    fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
    process.exit(1);
  }
  console.log('passed: ' + pass + '   failed: 0');
  console.log('✓ paypal-orders-webhook-recovery tests passed');
  process.exit(0);
})();
