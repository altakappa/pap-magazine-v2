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

// 애드온 가격 (유로센트) — 서버 단일 소스. 모르는 키는 unknown_addon 으로 거부된다.
// 2026-09-12 도메니코 — 유료 애드온 전부 폐지.
//   · ig_collab(€110 공동작업자 태그): 제출자가 폼에서 프리미엄 회원을 직접 지정(api/_lib/collaborators.js).
//   · ig_images_cover(€220 지정 이미지+커버): 커버 선택은 프리미엄 회원 혜택(폼에서 직접, 무료).
//   · posting_date(€110 게시일 지정): 서비스 종료.
// 표가 비어 있으므로 새 애드온 주문은 전부 unknown_addon. 과거 결제의 웹훅 기록(custom_id a|…)은 그대로 읽힌다.
const ADDON_FEE_CENTS = {};

const ADDON_LABEL = {};

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
  /* 아티클 기고 게재료 (2026-11-12) — €790, 홍보성으로 판정된 건만.
   *
   * 에디토리얼과 다른 점 하나: 금액의 근거가 **심사 결과**다.
   *   에디토리얼은 제출 시점에 룩·브랜드 구성으로 유형이 정해지므로 제출과
   *   동시에 금액이 나온다. 아티클은 도메니코가 심사에서 '홍보성' 으로
   *   판정해야 비로소 €790 이 된다(도메니코 결정 2026-11-12: 심사 후 통보).
   *   그래서 여기서는 article_submissions.fee_type 을 본다. 그 칸은 관리자
   *   엔드포인트만 쓸 수 있으므로 클라이언트가 위조할 수 없다.
   *
   * 금액은 submissionPayment.SUBMISSION_FEE_CENTS.branded 를 그대로 빌려 쓴다 —
   * 두 벌로 적으면 한쪽만 올라간다. */
  if (kind === 'article_fee') {
    if (!sub || String(sub.fee_type) !== 'branded') return { error: 'not_a_paid_article' };
    const { SUBMISSION_FEE_CENTS } = require('./submissionPayment');
    return { cents: SUBMISSION_FEE_CENTS.branded, label: 'PAP MAGAZINE article publication fee' };
  }
  if (kind === 'submission_addon') {
    const cents = ADDON_FEE_CENTS[addon];
    if (!cents) return { error: 'unknown_addon' };
    return { cents, label: 'PAP MAGAZINE add-on — ' + (ADDON_LABEL[addon] || addon) };
  }
  // 기본 게재료 — 저장된(위조 불가) 유형으로만 산출
  const type = storedSubmissionType(sub);
  if (!feeForType(type)) return { error: 'not_a_paid_submission' };
  // 2026-10-03 저장된 할인(연간 2번째 반값)을 반영한 실제 청구액. 주문·승인·캡처가 전부 이 값을 쓴다.
  const { effectiveFeeCents, storedFeeDiscount } = require('./submissionPayment');
  const cents = effectiveFeeCents(sub);
  const d = storedFeeDiscount(sub);
  return { cents, label: 'PAP MAGAZINE publication fee — ' + type + (d ? ' (' + d.pct + '% off)' : '') };
}

/** custom_id 로 되돌려 받을 식별자. PayPal 은 127자 제한이 있어 짧게 쓴다. */
function buildCustomId(kind, submissionId, addon) {
  if (kind === 'submission_addon') return `a|${submissionId}|${addon}`;
  if (kind === 'article_fee') return `af|${submissionId}`;   // 2026-11-12 아티클 기고 게재료
  return `f|${submissionId}`;
}

function parseCustomId(s) {
  const p = String(s || '').split('|');
  // 'af' 를 'a' 보다 먼저 본다 — split 결과의 첫 칸을 정확히 비교하므로
  // 접두어가 섞이지는 않지만, 읽는 사람이 헷갈리지 않게 순서를 맞춰 둔다.
  if (p[0] === 'af') return { kind: 'article_fee', submissionId: p[1] };
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
