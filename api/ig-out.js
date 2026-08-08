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
// 2026-07-29 — 조회수 쪽에서 쓰는 강화 판별기를 아웃클릭에도 적용한다.
// clickGuard.isLikelyBot 은 2026-07-20 판본이라 그 뒤에 정리된 크롤러 목록
// (gptbot·claudebot·applebot·yeti·ahrefsbot·semrush 등)을 모른다. 두 판별기를
// OR 로 묶어 한쪽만 아는 봇도 걸러낸다.
const { isBot } = require('./_lib/botDetect');

const HOME_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
// spa_fallback (2026-07-16): 원본 IG 게시물이 없는 에디토리얼(구계정 게시분 등)의
// SPA 폴백 CTA — 프로필 전환도 아웃클릭 지표에 잡히게 한다.
// pepperit-* (2026-07-17): 페퍼릿 기사 상세 CTA(pepperit-article)·랜딩 CTA(pepperit-spa)·
// 페퍼릿 footer CTA(pepperit-footer) 아웃클릭을 PAP와 분리 집계하기 위한 소스 태그.
// 화이트리스트 밖이면 'other'로 뭉뚱그려져 주간 리포트에서 매체 분리가 안 되므로 반드시 등록.
// editorial_mid (2026-07-29): 화보 갤러리 '중간'에 삽입한 CTA. 기존 'editorial'
// 은 갤러리 맨 아래에만 있어 중간 이탈 독자에게 노출되지 않았다. 두 위치를
// 분리 집계해야 "위치를 올린 것이 실제로 전환을 늘렸는가" 를 판정할 수 있다.
// youtube (2026-07-30): 유튜브 영상 설명란의 IG 링크. 사이트 밖(외부 플랫폼)에서
// 들어오는 첫 소스라 웹 내부 유입과 반드시 분리 집계해야 한다 — "유튜브가 인스타
// 팔로워를 실제로 만들어 주는가" 는 지금까지 측정한 적이 없는 값이다.
// 2026-07-30 3종 추가 — 각각 지금까지 계측 자체가 없던 표면이다.
//   brand           브랜드 허브 1,669페이지. 화보를 보러 온 팬과 브랜드 담당자가
//                   함께 보는 표면인데 IG 경로가 푸터 직링크뿐이라 기여도 0으로 보였다.
//   ssr_article     기사 SSR. 그동안 에디토리얼과 함께 'ssr' 로 뭉뚱그려져
//                   주간 73편이 나가는 채널의 기여도가 보이지 않았다.
//   submission_done 투고 완료 화면. 사이트에서 가장 고관여한 순간(심사 대기 중)인데
//                   인스타로 가는 길이 없었다.
// ssr_film 은 같은 분리 작업의 나머지 한 조각(필름 SSR).
// 2026-08-08 — 'newsletter' 추가: 이메일의 FOLLOW @PAP_MAGAZINE 버튼이 ig-out 을
// 경유하게 바꿨다 (이메일→IG 도 플라이휠 흐름이므로 계측한다 — email.js).
const SRC_WHITELIST = new Set(['article', 'editorial', 'editorial_mid', 'ssr', 'ssr_article', 'ssr_film', 'ssr_niche', 'naverblog', 'footer', 'nav', 'funnel', 'spa_fallback', 'pepperit-article', 'pepperit-spa', 'pepperit-footer', 'youtube', 'brand', 'submission_done', 'newsletter']);
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com']);

/* 경로형 단축 링크 /ig/:src (2026-07-30 신설).
 *
 * 왜 쿼리형(?to=&url=&src=) 을 그대로 쓰지 않나:
 *  ① 유튜브 설명란·DM 처럼 사람이 눈으로 보는 자리에 들어갈 링크라 짧아야 한다.
 *  ② 미디어킷에서 실측한 교훈 — 링크가 외부 앱을 거치면 추적성 쿼리 파라미터가
 *     지워지거나 재작성되는 일이 흔하다(2026-07-29). 경로 세그먼트는 중간
 *     매개체가 건드리지 않으므로 귀속이 살아남는다.
 * url 이 없으면 PAP 공식 프로필로 보낸다 — 오픈 리다이렉터가 되지 않도록
 * 목적지는 여기 코드에 박아 둔 값만 쓴다(쿼리로 받은 URL 은 종전대로 검증). */
const PROFILE_URL = 'https://www.instagram.com/pap_magazine';
function readPathSrc(req) {
  let pathname = '';
  try { pathname = new URL(req.url, 'https://x').pathname; } catch (_) { pathname = String(req.url || ''); }
  const seg = pathname.split('/').filter(Boolean);      // ['ig', '<src>']
  if (seg[0] !== 'ig' || !seg[1]) return '';
  return String(seg[1]).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

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

  const pathSrc = readPathSrc(req);
  // 경로형(/ig/:src)은 url 없이 오므로 공식 프로필을 기본 목적지로 쓴다.
  const dest = normalizeIgUrl(req.query.url) || (pathSrc ? PROFILE_URL : null);
  if (!dest) {
    return res.redirect(302, HOME_URL);
  }

  // 크롤러는 리다이렉트만, 로그 제외 (2026-07-20 — 7/16 대량 발행 때 'ssr'
  // 소스 1000회 스파이크가 크롤러발 허수였던 교훈. 사람 지표만 남긴다)
  // 2026-07-29 보강 — 위 필터가 있는데도 7/25~26 에 스파이크가 또 났다
  //   (7/26 1352회 · 고유 IP 978개 · IP당 1.4회 · 데스크톱 92%).
  //   평소 사람 트래픽은 IP 20~60개가 각 2.5~6회, 모바일 우세다. 즉 UA 목록이
  //   낡아 새 크롤러를 놓친 것. botDetect.isBot(조회수 쪽에서 검증된 최신 목록)을
  //   OR 로 함께 태운다.
  const _ua = req.headers['user-agent'];
  if (isLikelyBot(_ua) || isBot(_ua)) {
    return res.redirect(302, dest);
  }

  // 쿼리 우선, 없으면 경로 세그먼트 (외부 앱이 쿼리를 지워도 귀속이 남는다)
  const srcRaw = String(req.query.src || pathSrc || '').toLowerCase();
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
      // 2026-07-29 — UA 를 남긴다. 브라우저 UA 로 위장한 스크래퍼는 목록 기반
      // 필터로는 못 잡으므로, 다음에 스파이크가 나면 실제 UA 를 보고 정확한
      // 규칙을 만들기 위한 근거를 확보한다. 200자 절단.
      user_agent: (typeof _ua === 'string' && _ua) ? _ua.slice(0, 200) : null,
    });
    if (error) console.warn('[ig-out] click insert failed', error.message);
  } catch (e) {
    console.warn('[ig-out] click insert threw', e && e.message);
  }

  return res.redirect(302, dest);
};
