/**
 * GET /api/subscriptions/paddle-config — 해외 결제(Paddle) 클라이언트 설정
 *
 * Paddle.js 오버레이 체크아웃에 필요한 공개 값들을 내려준다:
 *   environment  — 'sandbox' | 'production'
 *   clientToken  — Paddle client-side token (공개용 — 브라우저에 노출돼도 안전)
 *   prices       — plan key → Paddle price id (pri_…)
 *
 * 미설정 시 503 → 프론트는 해외 결제 버튼을 비활성/안내 처리.
 */

const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

// 환경 판별 — token prefix 로 auto-detect (PADDLE_ENV 미설정·오설정 방지)
//   Production client token: 'live_...'
//   Sandbox client token:    'test_...'
// PADDLE_ENV 를 명시하면 그 값을 우선하되, token prefix 와 어긋나면 token 을 신뢰.
function detectEnvironment(token) {
  const envExplicit = process.env.PADDLE_ENV;
  const tokenIsLive = /^live_/i.test(token || '');
  const tokenIsTest = /^test_/i.test(token || '');
  if (envExplicit === 'production' && !tokenIsTest) return 'production';
  if (envExplicit === 'sandbox' && !tokenIsLive) return 'sandbox';
  if (tokenIsLive) return 'production';
  return 'sandbox';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // ── 결제 일시중단 킬스위치 (2026-08-10) ────────────────────────────
  // Paddle 계정이 2026-08-14 에 닫힌다. 그 이후 토큰이 죽으면 체크아웃이 원인
  // 불명 에러로 터지고, 사용자는 "고장난 사이트"를 본다. 그건 절대 안 된다.
  //   PAYMENTS_PAUSED=1  → 200 으로 { paused:true } 를 내려 프론트가 결제창을
  //                        열지 않고 안내 문구를 띄우게 한다.
  // 토큰을 지우기 전에 이 스위치를 먼저 켠다. clientToken 검사보다 앞에 두는 이유:
  // 토큰을 Vercel 에서 삭제해도 503 이 아니라 이 안내 경로로 흐르게 하기 위함.
  // ⚠️ env 변경 후에는 반드시 재배포한다 (Vercel 은 빌드 시점에 env 를 굽는다).
  if (process.env.PAYMENTS_PAUSED === '1') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      paused: true,
      reason: 'provider_migration',
      contactEmail: 'contact@pap-magazine.com',
    });
  }

  const clientToken = process.env.PADDLE_CLIENT_TOKEN;
  if (!clientToken) {
    return res.status(503).json({
      message: 'International payment not yet configured.',
      detail: 'PADDLE_CLIENT_TOKEN missing on the server.',
    });
  }

  const prices = {
    standard_monthly: process.env.PADDLE_PRICE_STD_M || null,
    standard_yearly:  process.env.PADDLE_PRICE_STD_Y || null,
    premium_monthly:  process.env.PADDLE_PRICE_PREM_M || null,
    premium_yearly:   process.env.PADDLE_PRICE_PREM_Y || null,
  };

  // 2026-08-03 시윤 3단계 — 재체험 차단용 '체험 없는' price id.
  // Paddle 에서 같은 금액·같은 주기로 trial period 만 뺀 price 를 하나 더 만들어
  // 이 env 에 넣는다. 프론트는 /subscriptions/trial-eligibility 가 eligible:false 를
  // 주면 이 쪽 price 로 체크아웃을 연다(= 가입 즉시 결제, 체험 없음).
  // 미설정(null)이면 프론트는 기존 price 로 폴백한다 — 기능이 멈추지 않는다.
  const pricesNoTrial = {
    standard_monthly: process.env.PADDLE_PRICE_STD_M_NOTRIAL || null,
    standard_yearly:  process.env.PADDLE_PRICE_STD_Y_NOTRIAL || null,
    premium_monthly:  process.env.PADDLE_PRICE_PREM_M_NOTRIAL || null,
    premium_yearly:   process.env.PADDLE_PRICE_PREM_Y_NOTRIAL || null,
  };

  // 서브미션 일회성 기본료 price id (구독과 별개 — one-time). 미설정 시 null →
  // 프론트는 해당 유형 결제 버튼을 비활성/안내 처리. 체크아웃 시 프론트가
  // custom_data { submission_id, submission_type, user_id, kind:'submission_fee' }
  // 를 심어 paddle-webhook.js 의 submission_fee 분기로 라우팅한다.
  const submissionFees = {
    paid_few_looks: process.env.PADDLE_PRICE_SUB_FEWLOOKS || null, // €380
    branded:        process.env.PADDLE_PRICE_SUB_BRANDED || null,  // €790
  };

  // 서브미션 부가서비스 one-time price (2026-07-20 도메니코 지시 — PayPal→Paddle 전환).
  // 미설정(null) 시 프론트는 기존 PayPal 링크로 폴백한다. env는 도메니코가 Paddle
  // 콘솔에서 상품 생성 후 Vercel에 설정 (price id는 공개값).
  const submissionAddons = {
    ig_collab:       process.env.PADDLE_PRICE_ADDON_COLLAB || null, // €110 Instagram Collaborators
    ig_images_cover: process.env.PADDLE_PRICE_ADDON_IMAGES || null, // €220 Specific images + cover
    posting_date:    process.env.PADDLE_PRICE_ADDON_DATE   || null, // €110 Specifying a posting date
  };

  // 설정은 배포 단위로만 바뀜 — 5분 edge cache.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).json({
    environment: detectEnvironment(clientToken),
    clientToken,
    prices,
    pricesNoTrial,
    submissionFees,
    submissionAddons,
  });
};
