// PAP Magazine — Submission base-fee webhook branch test
//
// Guards the 2단계-b feature: Paddle ONE-TIME `transaction.completed` events
// carrying custom_data.kind='submission_fee' flip a submission to
// payment_status='paid' — and ONLY that. Verifies:
//   • submission_fee → paid transition + correct euro-cent amount
//   • idempotent re-receive (same paddle_transaction_id) is skipped, no 2nd write
//   • subscription transaction.completed events are NOT intercepted
//   • unresolved submission never throws (webhook can still 200)
//   • payment fields only — status/approved/published untouched
//
// Exercises the REAL production helper (api/_lib/submissionPayment.js) — the
// exact module api/paddle-webhook.js imports — so the test can't drift.
//
// Run with `node tests/submission-payment.test.js` (wired into `npm test`).

'use strict';

const path = require('path');
const {
  handleSubmissionFeeTransaction,
  isSubmissionFeeEvent,
  feeForType,
} = require(path.resolve(__dirname, '..', 'api', '_lib', 'submissionPayment'));

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures.push({ label, detail }); failed++; }
}

// Minimal supabase-client mock. Records every .update() payload so we can assert
// that (a) the right columns are written and (b) nothing is written on skips.
function makeDb(row, opts = {}) {
  const calls = { updates: [], updateFilters: [] };
  const api = {
    from() { return api; },
    select() { return api; },
    eq() { return api; },
    maybeSingle() {
      return Promise.resolve({ data: row ? { ...row } : null, error: opts.selErr || null });
    },
    update(payload) {
      calls.updates.push(payload);
      return {
        eq(col, val) {
          calls.updateFilters.push({ col, val });
          return Promise.resolve({ error: opts.updErr || null });
        },
      };
    },
  };
  return { db: api, calls };
}

function feeTx(overrides = {}) {
  return {
    id: overrides.id || 'txn_001',
    subscription_id: overrides.subscription_id || null,
    custom_data: {
      kind: 'submission_fee',
      submission_id: 'sub-abc',
      submission_type: 'paid_few_looks',
      user_id: 'user-1',
      ...(overrides.custom_data || {}),
    },
    details: overrides.details,
  };
}

// Build a submissions row whose `description` JSON carries the authoritative
// (server-recomputed) submissionType — the value the fee must key off.
function row(over = {}) {
  const { storedType, ...rest } = over;
  const base = {
    id: 'sub-abc', user_id: 'user-1', payment_status: 'none', paddle_transaction_id: null,
  };
  const merged = { ...base, ...rest };
  if (storedType !== undefined) {
    merged.description = JSON.stringify({ artistStatement: 'x', submissionType: storedType });
  }
  return merged;
}

// Paddle transaction details with a pre-tax subtotal (minor units string).
function withSubtotal(cents) {
  const tax = Math.round(cents * 0.2);
  return { totals: { subtotal: String(cents), tax: String(tax), total: String(cents + tax) } };
}

(async () => {
  console.log('\n=== event routing ===');
  ok('submission_fee event is recognized',
     isSubmissionFeeEvent(feeTx()) === true);
  ok('missing submission_id is NOT a submission_fee event',
     isSubmissionFeeEvent({ custom_data: { kind: 'submission_fee' } }) === false);
  ok('subscription tx (no submission_fee) is NOT a submission_fee event',
     isSubmissionFeeEvent({ id: 'txn_s', subscription_id: 'sub_123', custom_data: { user_id: 'u' } }) === false);

  console.log('\n=== fee mapping ===');
  ok('paid_few_looks → 38000', feeForType('paid_few_looks') === 38000);
  ok('branded → 79000', feeForType('branded') === 79000);
  ok('unknown type → null', feeForType('mystery') === null);

  console.log('\n=== paid transition ===');
  {
    const { db, calls } = makeDb({ id: 'sub-abc', user_id: 'user-1', payment_status: 'none', paddle_transaction_id: null });
    const r = await handleSubmissionFeeTransaction(feeTx(), db);
    ok('outcome=paid', r.outcome === 'paid', r.outcome);
    ok('one update written', calls.updates.length === 1, String(calls.updates.length));
    const u = calls.updates[0] || {};
    ok('payment_status=paid written', u.payment_status === 'paid');
    ok('paid_amount=38000 written', u.paid_amount === 38000, String(u.paid_amount));
    ok('paddle_transaction_id written', u.paddle_transaction_id === 'txn_001');
    ok('does NOT write status/approved/published',
       !('status' in u) && !('approved' in u) && !('published' in u),
       Object.keys(u).join(','));
  }

  console.log('\n=== branded amount ===');
  {
    const { db, calls } = makeDb({ id: 'sub-abc', user_id: 'user-1', payment_status: 'none', paddle_transaction_id: null });
    const r = await handleSubmissionFeeTransaction(
      feeTx({ id: 'txn_b', custom_data: { submission_type: 'branded' } }), db);
    ok('branded outcome=paid', r.outcome === 'paid');
    ok('branded paid_amount=79000', (calls.updates[0] || {}).paid_amount === 79000, String((calls.updates[0] || {}).paid_amount));
  }

  console.log('\n=== authoritative stored type + underpayment ===');
  {
    // Stored (authoritative) type is BRANDED (€790), but the client spoofed
    // custom_data.submission_type=paid_few_looks and only paid €380 (38000).
    const { db, calls } = makeDb(row({ storedType: 'branded' }));
    const r = await handleSubmissionFeeTransaction(
      feeTx({ id: 'txn_under', custom_data: { submission_type: 'paid_few_looks' }, details: withSubtotal(38000) }), db);
    ok('outcome=paid (money changed hands)', r.outcome === 'paid', r.outcome);
    ok('storedType reported as branded', r.storedType === 'branded', r.storedType);
    ok('expectedAmount from STORED type = 79000', r.expectedAmount === 79000, String(r.expectedAmount));
    ok('paid_amount records ACTUAL charge 38000', (calls.updates[0] || {}).paid_amount === 38000, String((calls.updates[0] || {}).paid_amount));
    ok('underpaid=true', r.underpaid === true);
  }
  {
    // Stored BRANDED, correct €790 charge → not underpaid.
    const { db, calls } = makeDb(row({ storedType: 'branded' }));
    const r = await handleSubmissionFeeTransaction(
      feeTx({ id: 'txn_ok', custom_data: { submission_type: 'branded' }, details: withSubtotal(79000) }), db);
    ok('correct branded → outcome=paid', r.outcome === 'paid');
    ok('correct branded → not underpaid', r.underpaid === false);
    ok('correct branded → expected 79000', r.expectedAmount === 79000);
    ok('correct branded → paid_amount 79000', (calls.updates[0] || {}).paid_amount === 79000, String((calls.updates[0] || {}).paid_amount));
  }
  {
    // storedType takes PRIORITY over the client type when they disagree.
    // Stored few-looks (€380), client claims branded → expected keys off stored (38000).
    const { db } = makeDb(row({ storedType: 'paid_few_looks' }));
    const r = await handleSubmissionFeeTransaction(
      feeTx({ id: 'txn_pri', custom_data: { submission_type: 'branded' }, details: withSubtotal(38000) }), db);
    ok('expected uses STORED few-looks (38000), not client branded', r.expectedAmount === 38000, String(r.expectedAmount));
    ok('paying the stored fee is not underpaid', r.underpaid === false);
  }
  {
    // No stored type on the row → falls back to client custom_data type for expected.
    const { db } = makeDb(row()); // no description
    const r = await handleSubmissionFeeTransaction(
      feeTx({ id: 'txn_fb', custom_data: { submission_type: 'branded' }, details: withSubtotal(79000) }), db);
    ok('fallback expected from client type = 79000', r.expectedAmount === 79000, String(r.expectedAmount));
    ok('fallback storedType is null', r.storedType == null);
  }

  console.log('\n=== idempotency (same tx re-received) ===');
  {
    // Row already stamped with THIS transaction id → must skip, no write.
    const { db, calls } = makeDb({ id: 'sub-abc', user_id: 'user-1', payment_status: 'paid', paddle_transaction_id: 'txn_001' });
    const r = await handleSubmissionFeeTransaction(feeTx({ id: 'txn_001' }), db);
    ok('outcome=duplicate', r.outcome === 'duplicate', r.outcome);
    ok('no update written on duplicate', calls.updates.length === 0, String(calls.updates.length));
  }

  console.log('\n=== already paid by a different tx ===');
  {
    const { db, calls } = makeDb({ id: 'sub-abc', user_id: 'user-1', payment_status: 'paid', paddle_transaction_id: 'txn_OLD' });
    const r = await handleSubmissionFeeTransaction(feeTx({ id: 'txn_NEW' }), db);
    ok('outcome=already_paid_other_tx', r.outcome === 'already_paid_other_tx', r.outcome);
    ok('no overwrite written', calls.updates.length === 0, String(calls.updates.length));
    ok('reports existing tx', r.existingTx === 'txn_OLD');
  }

  console.log('\n=== subscription event is not intercepted ===');
  {
    const { db, calls } = makeDb(null);
    const subEvent = { id: 'txn_s', subscription_id: 'sub_123', custom_data: { user_id: 'u' } };
    const r = await handleSubmissionFeeTransaction(subEvent, db);
    ok('handled=false for subscription tx', r.handled === false, JSON.stringify(r));
    ok('no DB touch for subscription tx', calls.updates.length === 0);
  }

  console.log('\n=== unresolved submission never throws ===');
  {
    const { db, calls } = makeDb(null); // submission not found
    let threw = false;
    let r;
    try { r = await handleSubmissionFeeTransaction(feeTx({ id: 'txn_x' }), db); }
    catch (_) { threw = true; }
    ok('did not throw', threw === false);
    ok('outcome=unresolved', r && r.outcome === 'unresolved', r && r.outcome);
    ok('no update on unresolved', calls.updates.length === 0);
  }

  console.log('\n=== amount fallback from Paddle subtotal ===');
  {
    // Unknown submission_type → falls back to details.totals.subtotal (pre-tax).
    const { db, calls } = makeDb({ id: 'sub-abc', user_id: 'user-1', payment_status: 'none', paddle_transaction_id: null });
    const r = await handleSubmissionFeeTransaction(
      feeTx({ id: 'txn_f', custom_data: { submission_type: 'mystery' }, details: { totals: { subtotal: '38000', tax: '7600', total: '45600' } } }),
      db);
    ok('fallback outcome=paid', r.outcome === 'paid');
    ok('fallback amount = subtotal (38000, pre-tax)', (calls.updates[0] || {}).paid_amount === 38000, String((calls.updates[0] || {}).paid_amount));
  }

  console.log('\n=== user mismatch is a flag, not a block ===');
  {
    const { db } = makeDb({ id: 'sub-abc', user_id: 'owner-real', payment_status: 'none', paddle_transaction_id: null });
    const r = await handleSubmissionFeeTransaction(
      feeTx({ id: 'txn_m', custom_data: { user_id: 'someone-else' } }), db);
    ok('still paid despite mismatch', r.outcome === 'paid');
    ok('userMismatch flagged', r.userMismatch === true);
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} submission-payment: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('Failures:', JSON.stringify(failures, null, 2));
    process.exit(1);
  }
})().catch((e) => {
  console.error('submission-payment test crashed:', e);
  process.exit(1);
});
