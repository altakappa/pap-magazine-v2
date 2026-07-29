/**
 * GET /mediakit?lang=(ko|en)&src=(ig_bio|ig_post_XXXX|business|contact|…)
 *
 * 미디어킷 다운로드 계측 리다이렉트 (2026-07-29, 도메니코 요청).
 *
 * 왜: 미디어킷이 구글 드라이브 직링크라, 인스타 바이오에서 우리 사이트를 거치지
 * 않고 바로 드라이브로 간다. 드라이브는 통계를 주지 않으므로 "몇 명이 언제
 * 어디서 받았는지"가 전부 미측정이었다. 이건 광고주 퍼널에서 **유일하게 관측
 * 가능한 전환점**이다 — 인스타를 본 사람이 '이 매체 검토해볼까'로 움직인 순간.
 * 여기를 경유시키면 어떤 계정·게시물이 광고 문의로 이어지는지 처음으로 보인다.
 *
 * 설계는 검증된 api/ig-out.js 를 그대로 따른다(봇 필터·레이트리밋·ip_hash).
 * 다른 점 하나 — src 를 화이트리스트로 막지 않고 정규화만 한다.
 *   ig-out 은 소스 종류가 고정이라 화이트리스트가 맞지만, 여기서는 게시물별
 *   추적(ig_post_<shortcode>)이 목적이라 화이트리스트를 두면 전부 'other' 로
 *   뭉개져 정작 알고 싶은 것을 못 본다. 대신 [a-z0-9_-] 40자로 자른다.
 *
 * 안전:
 *  - 목적지는 코드 내장 드라이브 링크 또는 관리자가 settings 에 저장한 링크만.
 *    쿼리로 받은 URL 은 절대 쓰지 않는다 → 오픈 리다이렉터가 되지 않는다.
 *  - 관리자 저장 링크도 https + 허용 호스트(drive.google.com 등)만 통과.
 *  - 로그 실패는 삼킨다 — 방문자 리다이렉트는 항상 완료.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { rateLimitStrict } = require('./_lib/rateLimit');
const { extractClientIp, hashIp, detectDeviceType, sanitizeReferrer, isLikelyBot } = require('./_lib/clickGuard');
const { isBot } = require('./_lib/botDetect');

const HOME_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';

/* 내장 기본 링크 — 관리자(site_settings.business_page)에 저장된 링크가 없을 때만 쓴다.
   2026-07-29: 기존 폴백이던 파일 ID 2개(1gUeTUJrg…·1gVKLuOP…)는 라이브 확인 결과
   구글 드라이브 휴지통에 들어가 있어 "파일이 소유자의 휴지통에 있습니다" 가 떴다.
   business.html·contact.html 에 하드코딩돼 있던 그 ID 라, 사이트의 미디어킷
   버튼도 같은 화면을 보여주고 있었다는 뜻이다(광고주 대면 경로).
   → 관리자가 실제로 저장해 둔 폴더 링크를 기본값으로 승격한다. 파일이 바뀌어도
     폴더는 유지되므로 이쪽이 덜 깨진다. */
/* 2026-07-29(2차): 미디어킷 개편으로 파일이 교체돼 링크가 바뀌었다.
   같은 값을 site_settings.business_page 에도 반영했으므로 평소엔 그쪽이 쓰인다.
   여기는 설정 조회가 실패할 때만 쓰이는 최후 폴백. 링크가 또 바뀌면 두 곳을 함께 고칠 것. */
const DEFAULT_LINKS = {
  ko: 'https://drive.google.com/file/d/1uFbkibaSwtlODUUciieVExFZ-oWyZaCE/view?usp=sharing',
  en: 'https://drive.google.com/file/d/1rjZPyD5wy_amn_OMhlysuUJiN_zb_nBY/view?usp=sharing',
};

// 관리자가 settings 에 저장한 링크를 허용할 호스트. 그 외에는 내장 링크로 폴백.
const ALLOWED_HOSTS = new Set([
  'drive.google.com', 'docs.google.com',
  'www.pap-magazine.com', 'pap-magazine.com',
]);

function safeExternal(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw)); } catch (_) { return null; }
  if (u.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return null;
  return u.href;
}

/** src 정규화 — 게시물별 추적을 살리되 로그 오염은 막는다. */
function normalizeSrc(raw) {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return s || '';
}

/* lang·src 를 경로에서 먼저 읽고, 없으면 쿼리로 폴백한다 (2026-07-29 실측 후속).
 * 라이브 첫 검증에서 lang 은 들어오는데 src 는 계속 비어 'other' 로 기록됐다.
 * 원인을 확정하지는 못했지만, 링크가 인스타·페북·메신저를 거치면 추적성 쿼리
 * 파라미터가 지워지거나 재작성되는 일이 흔하다(도메니코가 보낸 드라이브 링크에도
 * fbclid 가 붙어 있었다). 이 링크는 애초에 그런 경로로만 유통될 물건이라
 * 쿼리에 의존하는 설계 자체가 약하다.
 *   /mediakit/ko/ig_bio  ·  /mediakit/ig_bio  ·  /mediakit?lang=ko&src=ig_bio
 * 경로 세그먼트는 중간 매개체가 건드리지 않으므로 이쪽을 1순위로 쓴다. */
function readParams(req) {
  let lang = '';
  let src = '';
  // 경로: /mediakit[/(ko|en)][/<src>]
  let pathname = '';
  try { pathname = new URL(req.url, 'https://x').pathname; } catch (_) { pathname = String(req.url || ''); }
  const seg = pathname.split('/').filter(Boolean); // ['mediakit', ...]
  const rest = seg[0] === 'mediakit' ? seg.slice(1) : seg.slice(0);
  rest.forEach((raw) => {
    const s = normalizeSrc(decodeURIComponent(raw));
    if (!s) return;
    if (!lang && (s === 'ko' || s === 'en')) { lang = s; return; }
    if (!src) src = s;
  });
  // 쿼리 폴백
  const q = req.query || {};
  if (!lang) lang = normalizeSrc(q.lang);
  if (!src) src = normalizeSrc(q.src);
  return { lang: lang === 'ko' ? 'ko' : 'en', src: src || 'other' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // 봇/스크립트의 로그 오염 방지 (ig-out 과 동일 한도)
  if (await rateLimitStrict(req, res, { limit: 60, windowMs: 60000 }, 'mediakit')) return;

  const { lang, src } = readParams(req);

  // 목적지 결정: 관리자 저장 링크 우선, 없거나 부적합하면 내장 링크
  let dest = DEFAULT_LINKS[lang];
  try {
    const { data } = await supabaseAdmin
      // ★ 테이블명은 site_settings 다 (api/settings.js 와 동일).
      //   2026-07-29 첫 배포에서 'settings' 로 조회해 항상 실패했고, try/catch 가
      //   경고만 남기고 삼켜서 조용히 내장 폴백으로 떨어졌다. 그 폴백이 휴지통에
      //   들어간 옛 파일이라 라이브에서 "파일이 소유자의 휴지통에 있습니다" 가 떴다.
      .from('site_settings').select('value').eq('key', 'business_page').maybeSingle();
    const v = data && data.value;
    const override = v && (lang === 'ko' ? v.mediakit_link_ko : v.mediakit_link_en);
    const safe = safeExternal(override);
    if (safe) dest = safe;
  } catch (e) {
    console.warn('[mediakit] settings lookup failed', e && e.message);
  }

  // 크롤러는 리다이렉트만 — 사람 지표만 남긴다 (ig-out 2026-07-20/29 교훈)
  const ua = req.headers['user-agent'];
  if (isLikelyBot(ua) || isBot(ua)) return res.redirect(302, dest);

  try {
    const { error } = await supabaseAdmin.from('mediakit_downloads').insert({
      lang,
      src,
      referrer_path: sanitizeReferrer(req.headers['referer'] || req.headers['referrer']),
      device_type: detectDeviceType(ua),
      ip_hash: hashIp(extractClientIp(req)), // salt 미설정 시 null
      user_agent: (typeof ua === 'string' && ua) ? ua.slice(0, 200) : null,
    });
    if (error) console.warn('[mediakit] insert failed', error.message);
  } catch (e) {
    console.warn('[mediakit] insert threw', e && e.message);
  }

  return res.redirect(302, dest || HOME_URL);
};
