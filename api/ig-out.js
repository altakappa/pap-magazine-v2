/**
 * GET /api/ig-out?to=(profile|post)&url=(인스타그램 URL)&src=(article|editorial|ssr|naverblog|footer|nav|funnel)
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
const { extractClientIp, hashIp, detectDeviceType, sanitizeReferrer } = require('./_lib/clickGuard');

const HOME_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const SRC_WHITELIST = new Set(['article', 'editorial', 'ssr', 'naverblog', 'footer', 'nav', 'funnel']);
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
