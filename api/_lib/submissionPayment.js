/**
 * Submission base-fee payment — Paddle one-time transaction handling.
 *
 * Scope (2단계-b, Domenico-confirmed 2026-07-19):
 *   Submissions outside the free editorial policy carry a ONE-TIME base fee,
 *   charged via Paddle (NOT a subscription):
 *     • few-looks (paid_few_looks) → €380 → 38000 euro-cents (2026-08-10 인상 — 세금 포함 최종가)
 *     • branded                    → €790 → 79000 euro-cents (2026-08-10 인상 — 세금 포함 최종가)
 *
 *   api/paddle-webhook.js routes `transaction.completed` events whose
 *   custom_data.kind === 'submission_fee' into handleSubmissionFeeTransaction()
 *   below. It flips ONLY the payment columns on the submission
 *   (payment_status='paid', paid_amount, paddle_transaction_id). It NEVER
 *   touches status/approved/published — publication is 100% manual (draft-only).
 *
 * IDEMPOTENCY: paddle_transaction_id doubles as the idempotency key. A
 * submission already stamped with the same transaction id is skipped
 * ('duplicate'). A submission already paid by a DIFFERENT transaction is left
 * untouched and loud-logged ('already_paid_other_tx').
 *
 * UNRESOLVED rows never throw — the caller returns HTTP 200 anyway so Paddle
 * does not retry-loop (mirrors the existing subscription.* pattern).
 *
 * This module contains NO subscription logic and shares NO state with the
 * subscription branch; the two are separated by custom_data.kind.
 */

'use strict';

// Euro-cents base fee per submission type (Domenico-confirmed 2026-07-19).
// Keys are normalized (lowercase, spaces/hyphens → underscore) — see normType.
const SUBMISSION_FEE_CENTS = {
  paid_few_looks: 38000,
  few_looks: 38000,
  fewlooks: 38000,
  branded: 79000,
};

/** Normalize a submission_type string for the fee map lookup. */
function normType(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Expected base fee (euro-cents) for a submission_type, or null if unknown. */
function feeForType(submissionType) {
  const key = normType(submissionType);
  return Object.prototype.hasOwnProperty.call(SUBMISSION_FEE_CENTS, key)
    ? SUBMISSION_FEE_CENTS[key]
    : null;
}

/**
 * Fallback amount (minor units, integer) read from the Paddle transaction when
 * custom_data.submission_type is missing/unknown. Prefers `subtotal` (pre-tax
 * base) because Paddle is Merchant-of-Record and adds VAT into total/grand_total.
 */
function paddleSubtotalCents(data) {
  const t = data && data.details && data.details.totals;
  if (!t) return null;
  const raw = t.subtotal != null ? t.subtotal : t.total;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Transaction currency code (e.g. 'EUR','USD'), or null. */
function paddleCurrency(data) {
  const t = data && data.details && data.details.totals;
  return (t && t.currency_code) || (data && data.currency_code) || null;
}

/** True iff this transaction is a submission base-fee (has kind + submission_id). */
function isSubmissionFeeEvent(data) {
  const cd = (data && data.custom_data) || {};
  return cd.kind === 'submission_fee' && !!cd.submission_id;
}

/**
 * Safely read the AUTHORITATIVE submissionType from a submission row.
 * `submissions.description` is a JSON string (see api/submissions/index.js) that
 * carries `submissionType` — recomputed server-side from the persisted looks, so
 * it can't be spoofed by the client. Returns null on any parse issue.
 */
function storedSubmissionType(sub) {
  if (!sub || sub.description == null) return null;
  try {
    const desc = typeof sub.description === 'string' ? JSON.parse(sub.description) : sub.description;
    return desc && desc.submissionType != null ? desc.submissionType : null;
  } catch (_) {
    return null;
  }
}

/**
 * Process a Paddle `transaction.completed` that carries kind:'submission_fee'.
 *
 * @param {object} data  event.data (the Paddle transaction object)
 * @param {object} db    supabase client (supabaseAdmin) — must expose
 *                        .from().select().eq().maybeSingle() and .update().eq()
 * @returns {Promise<{handled:boolean, outcome?:string, ...}>}
 *   handled=false               — not a submission-fee event (caller falls through)
 *   outcome='paid'              — payment_status flipped to paid
 *   outcome='duplicate'         — same tx already applied (idempotent skip)
 *   outcome='already_paid_other_tx' — paid by a different tx (left untouched)
 *   outcome='unresolved'        — submission not found (200 + loud log)
 *   outcome='error'             — DB error (caller decides logging)
 * Never throws for unresolved rows.
 */
async function handleSubmissionFeeTransaction(data, db) {
  if (!isSubmissionFeeEvent(data)) return { handled: false };

  const cd = data.custom_data || {};
  const submissionId = cd.submission_id;
  const txId = data.id;

  if (!txId) {
    return { handled: true, outcome: 'error', error: 'missing_transaction_id', submissionId };
  }

  const { data: sub, error: selErr } = await db
    .from('submissions')
    .select('id, user_id, payment_status, paddle_transaction_id, description')
    .eq('id', submissionId)
    .maybeSingle();

  if (selErr) {
    return { handled: true, outcome: 'error', error: selErr.message, submissionId, txId };
  }
  if (!sub) {
    return { handled: true, outcome: 'unresolved', reason: 'submission_not_found', submissionId, txId };
  }

  // Idempotency: same transaction already applied → skip (no write).
  if (sub.paddle_transaction_id && sub.paddle_transaction_id === txId) {
    return { handled: true, outcome: 'duplicate', submissionId, txId };
  }
  // Already paid by a DIFFERENT transaction — never overwrite; loud-log upstream.
  if (sub.payment_status === 'paid' && sub.paddle_transaction_id && sub.paddle_transaction_id !== txId) {
    return {
      handled: true, outcome: 'already_paid_other_tx',
      submissionId, txId, existingTx: sub.paddle_transaction_id,
    };
  }

  // Loud-log signal (does NOT block payment): custom_data user vs owner mismatch.
  const userMismatch = !!(cd.user_id && sub.user_id && cd.user_id !== sub.user_id);

  // EXPECTED amount is keyed off the AUTHORITATIVE stored type (server-recomputed,
  // spoof-proof), NOT the client-supplied custom_data.submission_type. Fall back
  // to the client type only when the row carries no usable stored type.
  const storedType = storedSubmissionType(sub);
  const expectedCents = feeForType(storedType) != null
    ? feeForType(storedType)
    : feeForType(cd.submission_type);

  // ACTUAL charged amount from Paddle (pre-tax subtotal) — recorded truthfully.
  const actualCents = paddleSubtotalCents(data);

  // paid_amount = what was really charged; fall back to expected if Paddle omitted totals.
  const paidAmount = actualCents != null ? actualCents : expectedCents;

  // Underpayment: real charge is below the fee owed for the stored type. Still
  // recorded as paid (money did change hands) — publication is a manual gate, and
  // the webhook loud-logs so Domenico catches it before publishing.
  //
  // 2026-07-20 — expectedCents는 euro-cents 상수다. 실제 결제 통화가 EUR가 아니면
  // minor-unit 직접 비교가 무의미(오탐)하므로 과소결제 판정을 보류한다. 통화 미상은
  // 기존 동작 유지(EUR 가정).
  const currency = paddleCurrency(data);
  const comparableCurrency = !currency || String(currency).toUpperCase() === 'EUR';
  const underpaid = comparableCurrency
    && expectedCents != null && actualCents != null && actualCents < expectedCents;

  const { error: updErr } = await db
    .from('submissions')
    .update({
      payment_status: 'paid',
      paid_amount: paidAmount,
      paddle_transaction_id: txId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId);

  if (updErr) {
    return { handled: true, outcome: 'error', error: updErr.message, submissionId, txId };
  }
  return {
    handled: true, outcome: 'paid', submissionId, txId,
    paidAmount, expectedAmount: expectedCents, storedType, underpaid, userMismatch,
    currency,
  };
}

module.exports = {
  handleSubmissionFeeTransaction,
  isSubmissionFeeEvent,
  feeForType,
  paddleSubtotalCents,
  paddleCurrency,
  SUBMISSION_FEE_CENTS,
};
