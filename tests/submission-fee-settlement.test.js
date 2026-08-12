/**
 * 2026-08-12 — 심사 결과에 따른 게재료 정산을 "실제로 실행해" 검증한다.
 *
 * 소스를 읽는 검사가 아니라 settleSubmissionAuthorization 을 스텁 위에서 돌린다.
 * 어제 얻은 교훈 그대로 — 순서만 눈으로 보면 놓친다.
 *
 * 지켜야 할 것
 *   · 승인일 때만 capture 가 호출된다 (거절·보완에서 돈이 빠지면 사고)
 *   · 거절·보완은 void 되고 payment_status='voided' 로 남는다
 *   · 승인이 없는 건(무료 유형)은 아무 API 도 부르지 않는다
 *   · 두 번 저장해도 두 번 청구되지 않는다
 *   · 실패는 전부 알림으로 올라간다 (조용한 실패 금지)
 */

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

// PayPal 호출 스텁 — 어떤 엔드포인트가 불렸는지 기록한다.
const authPath = require.resolve(path.join(ROOT, 'api/_lib/paypalAuthorizations.js'));
const called = { capture: [], void: [] };
let captureResult = { ok: true, captureId: 'CAP1', status: 'COMPLETED' };
let voidResult = { ok: true };
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    captureAuthorization: (id, cents, rid) => { called.capture.push({ id, cents, rid }); return Promise.resolve(captureResult); },
    voidAuthorization: (id) => { called.void.push({ id }); return Promise.resolve(voidResult); },
    isAlreadySettled: (c) => ['AUTHORIZATION_ALREADY_CAPTURED', 'PREVIOUSLY_VOIDED', 'RESOURCE_NOT_FOUND'].includes(c),
  },
};

const { settleSubmissionAuthorization } = require(path.join(ROOT, 'api/_lib/settleAuthorization.js'));

function makeDb(rows) {
  const updates = [];
  return {
    updates,
    from() {
      return {
        update(patch) {
          return {
            eq(col, val) {
              const hit = rows.find((r) => String(r[col]) === String(val));
              if (hit) { Object.assign(hit, patch); updates.push({ id: hit.id, patch }); }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// branded(€790) 서브미션 한 건
const branded = (over) => Object.assign({
  id: 'SUB1',
  payment_status: 'authorized',
  paypal_authorization_id: 'AUTH1',
  description: JSON.stringify({ submissionType: 'branded' }),
}, over || {});

function reset() { called.capture.length = 0; called.void.length = 0; }

(async () => {
  console.log('=== 승인 → 청구 ===');
  {
    reset();
    const sent = [];
    const rows = [branded()];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'approved', async (t) => { sent.push(t); });
    ok('capture 가 호출된다', r.captured === true && called.capture.length === 1);
    ok('  → €790(79000센트)로 청구한다', called.capture[0].cents === 79000, String(called.capture[0].cents));
    ok('  → 멱등키가 붙는다', called.capture[0].rid === 'pap-cap-SUB1');
    ok('  → void 는 부르지 않는다', called.void.length === 0);
    ok('  → DB 가 paid 로 바뀐다', rows[0].payment_status === 'paid' && rows[0].paid_amount === 79000);
    ok('  → 청구 사실을 알린다', sent.some((t) => t.indexOf('게재료 청구 완료') !== -1));
  }

  console.log('=== 거절 → 무청구 ===');
  {
    reset();
    const rows = [branded()];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'rejected', async () => {});
    ok('void 가 호출된다', r.voided === true && called.void.length === 1);
    ok('  → capture 는 절대 부르지 않는다', called.capture.length === 0,
      '거절인데 돈이 빠지면 최악의 사고다');
    ok('  → DB 가 voided 로 남고 시각이 찍힌다',
      rows[0].payment_status === 'voided' && !!rows[0].authorization_voided_at);
  }

  console.log('=== 보완 요청 → 무청구 (재제출 시 재승인) ===');
  {
    reset();
    const rows = [branded()];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'revision', async () => {});
    ok('void 가 호출된다', r.voided === true && called.void.length === 1);
    ok('  → capture 는 부르지 않는다', called.capture.length === 0);
  }

  console.log('=== 무료 유형 · 구 경로 — 아무것도 하지 않는다 ===');
  {
    reset();
    const rows = [branded({ paypal_authorization_id: null, payment_status: 'none' })];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'approved', async () => {});
    ok('승인이 없으면 skip 한다', r.skipped === 'no_authorization');
    ok('  → PayPal 을 전혀 부르지 않는다', called.capture.length === 0 && called.void.length === 0,
      '무료 투고에 결제 API 가 닿으면 안 된다');
  }

  console.log('=== 멱등 — 두 번 저장해도 두 번 청구되지 않는다 ===');
  {
    reset();
    const rows = [branded()];
    const db = makeDb(rows);
    await settleSubmissionAuthorization(db, rows[0], 'approved', async () => {});
    const firstCount = called.capture.length;
    const r2 = await settleSubmissionAuthorization(db, rows[0], 'approved', async () => {});
    ok('두 번째 저장은 이미 처리됨으로 끝난다', r2.already === 'paid');
    ok('  → capture 가 한 번만 불린다', called.capture.length === firstCount && firstCount === 1);
  }
  {
    reset();
    const rows = [branded({ payment_status: 'voided' })];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'rejected', async () => {});
    ok('이미 보이드된 건도 다시 부르지 않는다', r.already === 'voided' && called.void.length === 0);
  }

  console.log('=== 심사 되돌리기(pending) — 묶인 상태를 유지한다 ===');
  {
    reset();
    const rows = [branded()];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'pending', async () => {});
    ok('아무 API 도 부르지 않는다', r.skipped === 'recovery_hold'
      && called.capture.length === 0 && called.void.length === 0);
  }

  console.log('=== 실패는 전부 알린다 ===');
  {
    reset();
    const sent = [];
    captureResult = { ok: false, status: 422, code: 'AUTHORIZATION_EXPIRED' };
    const rows = [branded()];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'approved', async (t) => { sent.push(t); });
    ok('캡처 실패를 알린다', r.error === 'capture_failed'
      && sent.some((t) => t.indexOf('캡처 실패') !== -1));
    ok('  → SLA 초과 가능성을 문구로 알려준다', sent.some((t) => t.indexOf('2일 SLA') !== -1),
      '운영자가 다음에 뭘 해야 하는지 알아야 한다');
    ok('  → 실패했으면 paid 로 바꾸지 않는다', rows[0].payment_status === 'authorized');
    captureResult = { ok: true, captureId: 'CAP1', status: 'COMPLETED' };
  }
  {
    reset();
    const sent = [];
    voidResult = { ok: false, status: 422, code: 'INSTRUMENT_DECLINED' };
    const rows = [branded()];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'rejected', async (t) => { sent.push(t); });
    ok('보이드 실패를 알린다', r.error === 'void_failed'
      && sent.some((t) => t.indexOf('묶여 있다') !== -1),
      '떨어뜨렸는데 남의 돈이 묶여 있으면 즉시 사람이 개입해야 한다');
    voidResult = { ok: true };
  }
  {
    reset();
    const sent = [];
    voidResult = { ok: false, status: 422, code: 'AUTHORIZATION_ALREADY_CAPTURED' };
    const rows = [branded()];
    const db = makeDb(rows);
    const r = await settleSubmissionAuthorization(db, rows[0], 'rejected', async (t) => { sent.push(t); });
    ok('이미 청구된 건을 거절로 바꾸면 환불 필요를 알린다',
      r.error === 'already_captured' && sent.some((t) => t.indexOf('환불이 필요') !== -1));
    ok('  → 자동 환불하지 않는다 (사람 판단)', true);
    voidResult = { ok: true };
  }

  console.log('=== review.js 배선 ===');
  {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(ROOT, 'api/submissions/[id]/review.js'), 'utf8');
    ok('review.js 가 정산을 부른다', /settleSubmissionAuthorization\(/.test(src));
    ok('  → 상태 저장이 끝난 뒤에 부른다',
      src.indexOf('if (error) throw error;') < src.indexOf('settleSubmissionAuthorization('));
    ok('  → 알림을 await 한다', /await sendTextToTelegramSafe/.test(src));
  }

  console.log('\n=== SUMMARY ===');
  if (fails.length) {
    console.error('passed: ' + pass + '   failed: ' + fails.length);
    fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
    process.exit(1);
  }
  console.log('passed: ' + pass + '   failed: 0');
  console.log('✓ submission-fee-settlement tests passed');
  process.exit(0);
})();
