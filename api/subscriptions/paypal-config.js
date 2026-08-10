/**
 * GET /api/subscriptions/paypal-config — 해외 결제(PayPal) 클라이언트 설정
 *
 * 2026-08-10 · Paddle(MoR) 계정 폐쇄(8/14)로 PayPal 로 전환.
 *
 * ── 설계 메모 (왜 이렇게 단순한가) ─────────────────────────────────
 *  · 통화는 EUR 하나다. KRW 는 PayPal 지원 통화 25종에 아예 없고
 *    (CURRENCY_NOT_SUPPORTED_FOR_RECEIVER 로 실측 확인), 통화를 나누면
 *    정산·인보이스·부가세가 통화 수만큼 갈라진다. 서브미션이 이미 EUR
 *    (€380/€790)이므로 구독도 EUR 로 맞춰 한 줄로 만든다.
 *    → 언어→통화 매핑이 필요 없다. paddle-config 의 prices/pricesNoTrial
 *      이원화도 사라진다.
 *  · 무료 체험 폐지(2026-08-10) — trial 플랜이 없으므로 plan 이 하나뿐이다.
 *  · Paddle 은 MoR 이라 세금을 대신 걷었지만 PayPal 은 아니다. 표시가는
 *    "세금 포함 최종가"이며 세금은 회사가 부담한다(도메니코 결정).
 *
 * 내려주는 값은 전부 공개값이다. Secret 은 절대 이 응답에 넣지 않는다.
 *   clientId  — PayPal REST 앱의 Client ID (브라우저 SDK 로드에 필요)
 *   env       — 'live' | 'sandbox'
 *   currency  — 'EUR' 고정
 *   plans     — plan key → PayPal plan id (P-…)
 *
 * 미설정 시 503 → 프론트는 결제 버튼을 안내 처리한다.
 */

const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const PLAN_KEYS = ['standard_monthly', 'standard_yearly', 'premium_monthly', 'premium_yearly'];

/**
 * PAYPAL_PLANS_JSON 을 파싱한다. 형식:
 *   {"standard_monthly":"P-…","standard_yearly":"P-…",
 *    "premium_monthly":"P-…","premium_yearly":"P-…"}
 * 깨진 JSON 이나 빠진 키가 있어도 던지지 않는다 — 있는 것만 내려주고
 * 프론트가 없는 플랜의 버튼을 안내 처리하게 한다(전체 중단 방지).
 */
function parsePlans(raw) {
  if (!raw) return {};
  let obj;
  try { obj = JSON.parse(raw); } catch (_) {
    console.error('[paypal-config] PAYPAL_PLANS_JSON 파싱 실패 — 형식을 확인하세요');
    return {};
  }
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const k of PLAN_KEYS) {
    const v = obj[k];
    // PayPal plan id 는 'P-' 로 시작한다. 형식이 아니면 버린다(오설정 조기 발견).
    if (typeof v === 'string' && /^P-[A-Z0-9]+$/i.test(v.trim())) out[k] = v.trim();
  }
  return out;
}

function detectEnv() {
  const v = String(process.env.PAYPAL_ENV || '').toLowerCase();
  return v === 'sandbox' ? 'sandbox' : 'live';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // 결제 일시중단 킬스위치 — paddle-config 와 동일 계약.
  // clientId 검사보다 앞에 둔다: env 를 지워도 503 이 아니라 안내 경로로 흐른다.
  if (process.env.PAYMENTS_PAUSED === '1') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      paused: true,
      reason: 'provider_migration',
      contactEmail: 'contact@pap-magazine.com',
    });
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({
      message: 'International payment not yet configured.',
      detail: 'PAYPAL_CLIENT_ID missing on the server.',
    });
  }

  const plans = parsePlans(process.env.PAYPAL_PLANS_JSON);

  // 설정은 배포 단위로만 바뀐다 — 5분 edge cache.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).json({
    provider: 'paypal',
    env: detectEnv(),
    clientId,
    currency: 'EUR',
    plans,
  });
};
