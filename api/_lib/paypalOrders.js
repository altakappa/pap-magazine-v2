/**
 * 서브미션 일회성 결제 (PayPal Orders API) — 공용 로직
 * 2026-08-10 · Paddle(MoR) 폐쇄(8/14) 대응
 *
 * 구독(Subscriptions)과 완전히 다른 API 다. 구독은 플랜을 미리 만들어 두지만,
 * 일회성 결제는 요청마다 금액을 실어 보낸다.
 *
 * ⚠️ 금액은 절대 클라이언트에서 받지 않는다.
 *    submissions.description(JSON) 에 서버가 심어 둔 submissionType 으로만
 *    산출한다. 예전 Paddle 구조에서 클라이언트가 custom_data.submission_type 을
 *    낮은 유형으로 위조해 싼 값을 낼 수 있었던 구멍(2026-07-20 감사)을 원천 차단.
 *
 * ⚠️ 표시가는 "세금 포함 최종가"다(2026-08-10 도메니코 결정).
 *    Paddle 은 MoR 이라 부가세를 얹어 걷었지만 PayPal 은 아니다. 세금은 회사 부담.
 */

'use strict';

const { feeForType, storedSubmissionType } = require('./submissionPayment');

const PAYPAL_API_BASE = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

// 애드온 가격 (유로센트) — 2026-08-10 인상분 반영.
// 서버 단일 소스. 프론트 표시가(€110/€220/€110)와 반드시 같이 고칠 것.
const ADDON_FEE_CENTS = {
  ig_collab: 11000,        // €110 · Instagram Collaborators
  ig_images_cover: 22000,  // €220 · 지정 이미지 + 커버
  posting_date: 11000,     // €110 · 게시일 지정
};

const ADDON_LABEL = {
  ig_collab: 'Instagram Collaborators',
  ig_images_cover: 'Specific images + cover',
  posting_date: 'Posting date selection',
};

/** 유로센트 → PayPal 이 요구하는 소수 2자리 문자열 */
function centsToValue(cents) {
  return (Number(cents) / 100).toFixed(2);
}

async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_NOT_CONFIGURED');
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error('PayPal token failed: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function paypalFetch(path, opts) {
  const token = await getAccessToken();
  const r = await fetch(`${PAYPAL_API_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts && opts.headers) },
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

/**
 * 이 결제 건의 정당한 금액을 서버에서 산출한다.
 * @returns {{cents:number, label:string} | {error:string}}
 */
function resolveAmount(sub, kind, addon) {
  if (kind === 'submission_addon') {
    const cents = ADDON_FEE_CENTS[addon];
    if (!cents) return { error: 'unknown_addon' };
    return { cents, label: 'PAP MAGAZINE add-on — ' + (ADDON_LABEL[addon] || addon) };
  }
  // 기본 게재료 — 저장된(위조 불가) 유형으로만 산출
  const type = storedSubmissionType(sub);
  const cents = feeForType(type);
  if (!cents) return { error: 'not_a_paid_submission' };
  return { cents, label: 'PAP MAGAZINE publication fee — ' + type };
}

/** custom_id 로 되돌려 받을 식별자. PayPal 은 127자 제한이 있어 짧게 쓴다. */
function buildCustomId(kind, submissionId, addon) {
  return kind === 'submission_addon'
    ? `a|${submissionId}|${addon}`
    : `f|${submissionId}`;
}

function parseCustomId(s) {
  const p = String(s || '').split('|');
  if (p[0] === 'a') return { kind: 'submission_addon', submissionId: p[1], addon: p[2] };
  if (p[0] === 'f') return { kind: 'submission_fee', submissionId: p[1] };
  return null;
}

module.exports = {
  PAYPAL_API_BASE,
  ADDON_FEE_CENTS,
  ADDON_LABEL,
  centsToValue,
  getAccessToken,
  paypalFetch,
  resolveAmount,
  buildCustomId,
  parseCustomId,
};
