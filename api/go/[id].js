/**
 * GET /go/:id   (rewritten in vercel.json from /api/go/:id)
 *
 * Affiliate redirector per AFFILIATE_SPEC.md §2:
 *
 *   1. Look up brand by `brand_id` (must be status='active' AND have a URL
 *      for at least one region).
 *   2. Geo-route — KR visitors → affiliate_url_korea (falling back to
 *                  affiliate_url_global), everyone else → affiliate_url_global
 *                  ONLY. `affiliate_url_korea` is a KR-scoped link and must
 *                  never be served to non-KR traffic (2026-07-26; see
 *                  api/_lib/affiliateUrl.js for the reasoning).
 *      Vercel sets `x-vercel-ip-country` for serverless functions; we
 *      fall back to header-only detection (no IP API roundtrip).
 *   3. Record a click in `affiliate_clicks` — PII minimised:
 *        * ip_hash = SHA256(ip + PAP_IP_HASH_SALT)
 *        * referrer with query string stripped
 *        * UA truncated to 100 chars
 *      Dedup rule: same ip_hash × brand × 24h is marked counted=false.
 *      The brand is still redirected — only the analytic counter is gated.
 *   4. 302 redirect with Cache-Control: no-store so an old destination
 *      never sticks in shared caches when admin swaps the affiliate URL.
 *
 * Failure modes (all visit-safe):
 *   - Unknown brand_id  → 302 to home + log
 *   - Brand archived or no usable URL → 302 to home + log
 *   - Click insert errors → swallowed (redirect completes anyway)
 *   - Missing PAP_IP_HASH_SALT → redirect completes; click is NOT logged
 *     (chosen Phase 0 default, see clickGuard.js)
 *
 * Hot path budget per SPEC §13: < 200ms p95.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { extractClientIp, hashIp, detectDeviceType, sanitizeReferrer } = require('../_lib/clickGuard');
const { pickAffiliateUrl, regionFromCountry } = require('../_lib/affiliateUrl');

const HOME_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const SESSION_TTL_MS  = 24 * 60 * 60 * 1000; // 24h

// 2026-07-30 — 지역이 KR/GLOBAL 둘에서 KR/US/EU/GLOBAL 넷으로 늘었다.
// 마이테레사 MID 가 3개가 됐기 때문(APAC 43171 · US/CA 43172 · EU/UK/ME 35663).
// 국가→지역 매핑은 _lib/affiliateUrl.js 의 regionFromCountry 하나만 쓴다.
// affiliate_clicks.region 의 CHECK 제약도 네 값으로 함께 확장했다
// (마이그레이션 affiliate_clicks_region_add_us_eu) — 안 늘렸으면 insert 가
// 조용히 실패해 지표만 사라졌을 것이다.
function pickRegion(req) {
  const country = (req.headers['x-vercel-ip-country']
    || req.headers['cf-ipcountry']
    || req.headers['x-country-code']
    || ''
  ).toString();
  return regionFromCountry(country);
}

// 지역별 어필리에이트 URL 선택 — 규칙·근거는 ../_lib/affiliateUrl.js 주석 참조.
// (순수 함수라 유닛 테스트 가능하도록 _lib 로 분리: tests/affiliate-region-scope.test.js)

/**
 * Same-IP-same-brand-24h check. Returns true if a previous COUNTED click
 * exists in the window — caller will then mark this row counted=false but
 * still record it (so admin can audit dedup behaviour later).
 */
async function isDuplicate(ipHash, brandId, now) {
  if (!ipHash) return false; // no salt → we never dedup; the click isn't logged either
  const since = new Date(now.getTime() - DEDUP_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('affiliate_clicks')
    .select('id')
    .eq('ip_hash', ipHash)
    .eq('brand_id', brandId)
    .eq('counted', true)
    .gte('clicked_at', since)
    .limit(1);
  if (error) {
    console.warn('[go] dedup lookup failed', error.message);
    return false; // fail-open: would rather double-count than block traffic
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Fire-and-forget click record. We DO await it inside the handler so
 * Vercel's serverless runtime doesn't kill the function before the insert
 * finishes — but errors are swallowed so a Postgres hiccup never breaks
 * the redirect for a real visitor.
 */
async function recordClick({ brandId, region, req, now, destType }) {
  const ip = extractClientIp(req);
  // salt(PAP_IP_HASH_SALT) 있으면 SHA256(ip+salt) — PII 최소화 + 24h 중복제거 가능.
  // 없으면 null — IP 를 아예 저장하지 않되(프라이버시 안전) 클릭 자체는 기록한다.
  // (2026-07: 예전 "salt 없으면 로그 안 함" Phase 0 방침을 전환 — 전환 추적 우선)
  const ipHash = hashIp(ip); // null 가능 (ip_hash 컬럼은 nullable)

  const ua = String(req.headers['user-agent'] || '');
  const referrer = sanitizeReferrer(req.headers['referer'] || req.headers['referrer']);
  const device = detectDeviceType(ua);

  // 중복제거는 안정적인 salted hash 가 있을 때만 의미가 있다. ip_hash 가 null 이면
  // 서로 다른 클릭을 묶을 수 없으므로 모두 counted=true 로 집계한다.
  //
  // 2026-08-17 — 리퍼러 없는 직접 히트는 유효 클릭으로 세지 않는다.
  // 실측: 최근 7일 클릭 773건 중 731건이 리퍼러 없음 + 모바일 1.4% =
  // SSR 에 노출된 /go/ 링크를 크롤러가 수집해 직접 때리는 패턴.
  // 진짜 독자는 에디토리얼/브랜드 페이지에서 넘어오므로 same-origin
  // 리퍼러가 실려 온다 (사이트 Referrer-Policy 기준). 리다이렉트는
  // 그대로 해주되(방문자 무해) 지표만 안 센다 — 행은 남겨 감사 가능.
  const hasReferrer = !!referrer;
  const counted = hasReferrer && (ipHash ? !(await isDuplicate(ipHash, brandId, now)) : true);

  const sessionId = require('crypto').randomBytes(16).toString('hex');
  const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  const { error } = await supabaseAdmin
    .from('affiliate_clicks')
    .insert({
      brand_id: brandId,
      region: region,
      referrer_path: referrer,
      ip_hash: ipHash,
      user_agent_short: ua.slice(0, 100),
      device_type: device,
      session_id: sessionId,
      session_expires_at: sessionExpiresAt,
      counted: counted,
      destination_type: destType || null, // 'affiliate' | 'instagram' | 'search'
      // editorial_id + lead_creator_id intentionally null in Phase 0;
      // Phase 1 backfills both via the credit-extraction job.
    });

  if (error) {
    console.warn('[go] click insert failed', error.message);
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  // GET only — POST/etc don't make sense on an affiliate link.
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }
  // Rate-limit the redirector itself. Same `api` preset used elsewhere.
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // Always respond no-store — admin-changed URLs must propagate immediately.
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // 수익화 2.0 (2026-07) — 입력을 brand_id 뿐 아니라 @핸들·별칭·이름으로도
  // 해석한다. 화보 크레딧(Fashion by @handle)에서 바로 /go/<핸들> 로 걸 수
  // 있게 하기 위함 — 렌더 시점 브랜드 조회 비용 0.
  const raw = decodeURIComponent((req.query.id || '').toString()).trim();
  const norm = raw.replace(/^@+/, '').toLowerCase();
  if (!norm) {
    return res.redirect(302, HOME_URL);
  }

  const now = new Date();
  const region = pickRegion(req);

  // 폴백 목적지 — 어필리에이트 URL이 없어도 빈손으로 돌려보내지 않는다.
  // KR → 무신사 검색, 그 외 → FARFETCH 검색. SKIMLINKS_PUB_ID 가 설정되면
  // 폴백 검색 URL을 Skimlinks 로 래핑해 자동 수익화한다.
  // (brands.affiliate_url_* 는 관리자가 넣은 '완성된' 링크로 간주 — 래핑 안 함)
  function searchFallback(name) {
    const q = encodeURIComponent(String(name || norm).trim());
    const dest = region === 'KR'
      ? 'https://www.musinsa.com/search/goods?keyword=' + q
      : 'https://www.farfetch.com/shopping/search/items.aspx?q=' + q;
    const pub = process.env.SKIMLINKS_PUB_ID;
    return pub
      ? 'https://go.skimresources.com/?id=' + encodeURIComponent(pub) + '&xs=1&url=' + encodeURIComponent(dest)
      : dest;
  }

  let brand = null;
  try {
    const SEL = 'brand_id,display_name,status,affiliate_url_global,affiliate_url_korea,instagram_handle';
    // 1) brand_id 직접
    let r = await supabaseAdmin.from('brands').select(SEL).eq('brand_id', norm).maybeSingle();
    brand = r.data || null;
    // 2) 별칭 테이블 (크레딧 문자열 → brand_id)
    if (!brand) {
      const a = await supabaseAdmin.from('brand_aliases').select('brand_id').eq('alias', norm).maybeSingle();
      if (a.data && a.data.brand_id) {
        r = await supabaseAdmin.from('brands').select(SEL).eq('brand_id', a.data.brand_id).maybeSingle();
        brand = r.data || null;
      }
    }
    // 3) 인스타 핸들
    if (!brand) {
      r = await supabaseAdmin.from('brands').select(SEL).eq('instagram_handle', norm).limit(1).maybeSingle();
      brand = r.data || null;
    }
  } catch (e) {
    console.error('[go] brand lookup threw', e && e.message);
  }

  // 목적지 우선순위 (2026-07 개선):
  //   1) active 브랜드 + affiliate_url(global/korea) 있음 → affiliate_url
  //      (archived 브랜드의 낡은/만료 링크로 보내지 않도록 active 일 때만 사용)
  //   2) 아니면 브랜드 공식 인스타그램 프로필 (instagram_handle)
  //      — 어필리에이트 승인 전에도 "엉뚱한 검색"보다 훨씬 자연스러운 목적지.
  //   3) 아니면 검색 폴백 (최후의 수단)
  // 승인이 나면 affiliate_url 이 채워지고 자동으로 1) 로 처리된다(코드 재배포 불필요).
  let dest = null;
  let destType = null;

  if (brand && brand.status === 'active') {
    const url = pickAffiliateUrl(brand, region);
    if (url) { dest = url; destType = 'affiliate'; }
  }

  if (!dest) {
    const handle = sanitizeIgHandle(brand && brand.instagram_handle);
    if (handle) {
      dest = 'https://www.instagram.com/' + handle + '/';
      destType = 'instagram';
    }
  }

  if (!dest) {
    dest = brand
      ? (searchFallback(brand.display_name || norm))
      : searchFallback(norm.replace(/[._]+/g, ' '));
    destType = 'search';
  }

  // 전환 추적 — 브랜드를 찾은 모든 경우에 클릭을 기록한다(affiliate_clicks.brand_id
  // 는 NOT NULL FK 라 브랜드 미확정 검색 폴백은 기록 불가 → 스킵). destination_type
  // 으로 어떤 폴백이었는지 남긴다. 기록이 실패해도 리다이렉트는 항상 완료된다.
  if (brand) {
    try { await recordClick({ brandId: brand.brand_id, region, req, now, destType }); }
    catch (e) { console.warn('[go] recordClick threw', e && e.message); }
  }

  return res.redirect(302, dest);
};

// 인스타 핸들 정규화 — @/공백 제거 후 IG 허용문자만. 유효하지 않으면 null.
function sanitizeIgHandle(raw) {
  if (!raw) return null;
  const h = String(raw).trim().replace(/^@+/, '').split(/[/?#\s]/)[0];
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
}
