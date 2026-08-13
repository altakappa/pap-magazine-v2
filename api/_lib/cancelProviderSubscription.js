/**
 * 회원 삭제·탈퇴 전에 결제사 구독을 먼저 끊는다 — 공용 헬퍼 (2026-08-10)
 *
 * ■ 왜 필요한가 (실측으로 드러난 구멍)
 *   api/admin/member-delete.js 는 회원을 지우면서 구독을 끊지 않았다.
 *   회원을 지워도 PayPal·Paddle 구독은 살아 있다 — 결제사는 우리 DB 를 모른다.
 *   결과: 서비스는 못 쓰는데 돈은 매달 계속 빠져나간다. 웹훅이 와도 회원이
 *   없어 매칭에 실패하고 조용히 지나간다. 이보다 확실한 지급거절 사유가 없다.
 *   Paddle 시절엔 고객이 Paddle 포털에서 직접 끊을 수 있어 덜 위험했지만,
 *   PayPal 에는 그 안전망이 없다.
 *
 * ■ 정책 (2026-08-10 도메니코 확정)
 *   "이미 낸 한 달치는 환불하지 않는다. 구독 기간이 끝난 뒤로 재결제만 막는다."
 *   → 이 헬퍼는 **절대 환불하지 않는다.** 다음 결제만 중단시킨다.
 *   → Paddle 은 effective_from: 'next_billing_period' (기간 말 종료)
 *   → PayPal 구독 해지는 즉시 상태가 바뀌지만 이미 받은 대금은 그대로다.
 *
 * ■ 호출부 계약
 *   실패하면 { ok:false } 를 돌려준다. 호출부는 **삭제를 진행하지 말 것.**
 *   돈이 계속 나가는 것보다 삭제가 안 되는 편이 낫다.
 *
 * ■ 🔴 2026-08-12 — Paddle 폐쇄 이후 예외 (도메니코 지시)
 *   위 계약에는 전제가 있다: "해지에 실패하면 돈이 계속 나간다."
 *   Paddle 계정이 2026-08-14 에 닫히면 그 전제가 무너진다. 청구할 주체 자체가
 *   사라지므로 해지 실패는 더 이상 금전 위험이 아니다. 그런데 계약을 그대로 두면
 *   반대 방향의 사고가 난다 — Paddle 구독이 남아 있는 회원 6명이 **탈퇴 자체를
 *   영원히 못 하게 된다.** 개인정보 파기 의무를 코드가 막는 셈이다.
 *
 *   그래서 폐쇄 시점 이후에는 Paddle 분기를 "성공" 으로 취급하고 탈퇴를 통과시킨다.
 *   대신 텔레그램으로 반드시 알린다 — 조용히 넘기면 진짜로 살아 있는 구독을
 *   놓칠 수 있다. PayPal 분기는 그대로다(그쪽은 계속 청구된다).
 */

'use strict';

const PAYPAL_API_BASE = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';
const PADDLE_API_BASE = process.env.PADDLE_ENV === 'production'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';

// Paddle 계정 폐쇄 시각. 이 뒤로는 Paddle 에 청구할 주체가 없다.
// 날짜를 코드에 박은 이유: env(PADDLE_SHUTDOWN=1)만 두면 설정을 잊었을 때
// 회원 탈퇴가 조용히 막힌다. 잊어도 동작하게 하고, env 로 앞당길 수 있게 둔다.
const PADDLE_SHUTDOWN_AT = Date.UTC(2026, 7, 14, 0, 0, 0); // 2026-08-14 00:00 UTC
function paddleIsGone() {
  if (String(process.env.PADDLE_SHUTDOWN || '') === '1') return true;
  return Date.now() >= PADDLE_SHUTDOWN_AT;
}

// 알림은 지연 require — 이 모듈은 탈퇴·삭제 경로 양쪽에서 로드되므로
// 로드 시점에 부수효과를 만들지 않는다.
function alertSafe(text) {
  try {
    const { sendTextToTelegramSafe } = require('./telegram');
    return sendTextToTelegramSafe(text);
  } catch (_) { return Promise.resolve(); }
}

async function paypalToken() {
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
  if (!r.ok) throw new Error('PayPal token failed');
  return j.access_token;
}

/**
 * @returns {Promise<{ok:boolean, action:string, provider?:string, message?:string}>}
 *   action: 'none' | 'already' | 'canceled' | 'failed'
 */
async function cancelProviderSubscription(db, userId) {
  let row = null;
  try {
    const { data, error } = await db
      .from('subscriptions')
      .select('paypal_subscription_id, paddle_subscription_id, status, provider')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = data;
  } catch (e) {
    // 조회조차 실패하면 판단할 근거가 없다 — 삭제를 막는다.
    return { ok: false, action: 'failed', message: 'subscription lookup failed: ' + e.message };
  }

  if (!row) return { ok: true, action: 'none' };
  const st = String(row.status || '').toLowerCase();
  if (st === 'canceled' || st === 'expired') {
    return { ok: true, action: 'already', provider: row.provider || null };
  }

  try {
    if (row.paypal_subscription_id) {
      const token = await paypalToken();
      const r = await fetch(
        `${PAYPAL_API_BASE}/v1/billing/subscriptions/${encodeURIComponent(row.paypal_subscription_id)}/cancel`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          // 환불이 아니다. 다음 결제를 막는 것뿐이다.
          body: JSON.stringify({ reason: 'Account closed by user or admin — future billing stopped, no refund' }),
        }
      );
      if (r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        const alreadyDone = r.status === 422
          && JSON.stringify(j).indexOf('SUBSCRIPTION_STATUS_INVALID') !== -1;
        if (!alreadyDone) {
          return { ok: false, action: 'failed', provider: 'paypal',
                   message: 'PayPal cancel failed (' + r.status + ')' };
        }
      }
    } else if (row.paddle_subscription_id) {
      // 🔴 폐쇄 이후에는 Paddle 을 부르지 않는다. 부를 곳이 없고, 실패가
      //    탈퇴를 막는 것이 유일한 결과다. 대신 반드시 알린다.
      if (paddleIsGone()) {
        await alertSafe('ℹ️ Paddle 폐쇄 후 탈퇴/삭제 — Paddle 해지 호출을 건너뛰었습니다.'
          + ' user=' + userId + ' paddle_sub=' + row.paddle_subscription_id
          + ' — 혹시 살아 있는 구독이면 수동으로 확인해 주세요.');
      } else {
        if (!process.env.PADDLE_API_KEY) {
          return { ok: false, action: 'failed', provider: 'paddle', message: 'PADDLE_API_KEY missing' };
        }
        const r = await fetch(
          `${PADDLE_API_BASE}/subscriptions/${encodeURIComponent(row.paddle_subscription_id)}/cancel`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}`, 'Content-Type': 'application/json' },
            // 기간 말 종료 — 이미 낸 기간은 그대로 둔다.
            body: JSON.stringify({ effective_from: 'next_billing_period' }),
          }
        );
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          const detail = (j.error && j.error.detail) || ('Paddle ' + r.status);
          return { ok: false, action: 'failed', provider: 'paddle', message: detail };
        }
      }
    } else {
      // 결제사 식별자가 없는 행(수동 승급 등) — 끊을 것이 없다.
      return { ok: true, action: 'none' };
    }
  } catch (e) {
    return { ok: false, action: 'failed', message: e.message };
  }

  // 우리 쪽 상태도 즉시 표시해 둔다(확정은 웹훅이 다시 갱신).
  try {
    await db.from('subscriptions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } catch (_) { /* 표시 실패는 치명적이지 않다 — 결제는 이미 멈췄다 */ }

  return { ok: true, action: 'canceled', provider: row.paypal_subscription_id ? 'paypal' : 'paddle' };
}

// paddleIsGone 도 내보낸다 — 해지 엔드포인트(api/subscriptions/paddle-portal.js)가
// 같은 시각 기준을 써야 한다. 두 곳에 날짜를 각각 박으면 한쪽만 고치는 사고가 난다.
module.exports = { cancelProviderSubscription, paddleIsGone, PADDLE_SHUTDOWN_AT };
