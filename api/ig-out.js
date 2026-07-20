/**
 * GET /api/ig-out?to=(profile|post)&url=(인스타그램 URL)&src=(article|editorial|ssr|ssr_niche|naverblog|footer|nav|funnel|spa_fallback)
 *
 * 웹 → 인스타그램 유입 계측 리다이렉트 (B-2, 2026-07).
 * 지금까지 IG 버튼이 전부 직링크라 "몇 명이 인스타로 넘어갔는지"를 알 수
 * 없었다. 모든 IG 아웃링크가 여기를 경유하며 ig_outclicks 에 1행 기록 후
 * 302 리다이렉트한다. 측정이 되어야 진성 팔로워 전환을 최적화할 수 있다.
 *
 * 안전 규칙:
 *  - instagram.com / www.instagram.com HTTPS URL만 허용 (오픈 리다이렉터 방지)
 *    → 그 외에는 홈(/)으로 리다이렉트
 *  - 로그 실패는 삼킨다 — 방문자 리다이렉트는 항상 완료 (affiliate /go 와 동일)
 *  - ip_hash = SHA256(ip + PAP_IP_HASH_SALT), salt 미설정이면 null로 기록
 *  - rl_hit(DB 영속) 레이트리밋 — 봇의 로그 오염 방지
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { rateLimitStrict } = require('./_lib/rateLimit');
const { extractClientIp, hashIp, detectDeviceType, sanitizeReferrer, isLikelyBot } = require('./_lib/clickGuard');

const HOME_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
// spa_fallback (2026-07-16): 원본 IG 게시물이 없는 에디토리얼(구계정 게시분 등)의
// SPA 폴백 CTA — 프로필 전환도 아웃클릭 지표에 잡히게 한다.
// pepperit-* (2026-07-17): 페퍼릿 기사 상세 CTA(pepperit-article)·랜딩 CTA(pepperit-spa)·
// 페퍼릿 footer CTA(pepperit-footer) 아웃클릭을 PAP와 분리 집계하기 위한 소스 태그.
// 화이트리스트 밖이면 'other'로 뭉뚱그려져 주간 리포트에서 매체 분리가 안 되므로 반드시 등록.
const SRC_WHITELIST = new Set(['article', 'editorial', 'ssr', 'ssr_niche', 'naverblog', 'footer', 'nav', 'funnel', 'spa_fallback', 'pepperit-article', 'pepperit-spa', 'pepperit-footer']);
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com']);

/** instagram.com URL만 통과. 쿼리스트링(igshid 등 추적 노이즈)은 제거. */
function normalizeIgUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw)); } catch (_) { return null; }
  if (u.protocol !== 'https:') return null;
  if (!IG_HOSTS.has(u.hostname.toLowerCase())) return null;
  return 'https://www.instagram.com' + u.pathname;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }
  // 리다이렉트 목적지가 바뀔 수 있으니 캐시 금지 (/go 와 동일 방침)
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // 봇/스크립트의 로그 오염 방지 — DB 영속 rl_hit (분당 60회/IP)
  if (await rateLimitStrict(req, res, { limit: 60, windowMs: 60000 }, 'ig_out')) return;

  const dest = normalizeIgUrl(req.query.url);
  if (!dest) {
    return res.redirect(302, HOME_URL);
  }

  // 크롤러는 리다이렉트만, 로그 제외 (2026-07-20 — 7/16 대량 발행 때 'ssr'
  // 소스 1000회 스파이크가 크롤러발 허수였던 교훈. 사람 지표만 남긴다)
  if (isLikelyBot(req.headers['user-agent'])) {
    return res.redirect(302, dest);
  }

  const srcRaw = String(req.query.src || '').toLowerCase();
  const src = SRC_WHITELIST.has(srcRaw) ? srcRaw : 'other';

  const toRaw = String(req.query.to || '').toLowerCase();
  const toType = (toRaw === 'profile' || toRaw === 'post')
    ? toRaw
    : (/\/(p|reel|tv)\//.test(dest) ? 'post' : 'profile'); // 파라미터 누락 시 URL로 추론

  try {
    const { error } = await supabaseAdmin.from('ig_outclicks').insert({
      src: src,
      to_type: toType,
      target_url: dest.slice(0, 500),
      referrer_path: sanitizeReferrer(req.headers['referer'] || req.headers['referrer']),
      device_type: detectDeviceType(req.headers['user-agent']),
      ip_hash: hashIp(extractClientIp(req)), // salt 미설정 시 null
    });
    if (error) console.warn('[ig-out] click insert failed', error.message);
  } catch (e) {
    console.warn('[ig-out] click insert threw', e && e.message);
  }

  return res.redirect(302, dest);
};
