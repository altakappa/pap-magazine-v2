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

  // 설정은 배포 단위로만 바뀜 — 5분 edge cache.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).json({
    environment: detectEnvironment(clientToken),
    clientToken,
    prices,
  });
};
