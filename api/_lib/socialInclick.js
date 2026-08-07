/**
 * PAP Magazine — 소셜 유입(인바운드) 계측 (2026-07-16, 케이팝 참여 개선)
 *
 * 배경: X 자동 게시가 로드맵에서 "성과 미측정"으로 중단됐다. 이 모듈은 그
 * 짝이 되는 계측이다 — 트윗 링크에 utm_source 가 붙고(xPost.js withUtm),
 * utm_source 가 달린 SSR 페이지 히트를 social_inclicks 에 1행 기록한다.
 * 이제 "X 에서 몇 명이 넘어오는가"를 SQL 로 셀 수 있다.
 *
 * 집계 특성 (중요): SSR 은 CDN s-maxage 캐시가 있어 같은 URL 의 짧은 시간 내
 * 반복 방문은 함수에 도달하지 않는다 → 절대치가 아니라 "추세 지표"로 쓴다.
 * 실패는 항상 삼킨다 — 페이지 렌더가 우선 (ig-out 과 동일 방침).
 * 테이블 미생성 상태여도 안전 (insert 실패 → warn 후 무시).
 */

const { supabaseAdmin } = require('./supabase');
const { extractClientIp, hashIp, detectDeviceType, sanitizeReferrer, isLikelyBot } = require('./clickGuard');

/* 'threads' 추가 (2026-08-07) — 스레드 자동 게시가 링크를 달고 나가는데
   화이트리스트에 없어 전부 'other' 로 뭉개지고 있었다. 실측: social_inclicks
   120건이 **전부 'other'** 였다. 어디서 왔는지 모르는 데이터는 없는 것과 같다. */
const SRC_WHITELIST = new Set(['x', 'ig', 'naver', 'kakao', 'newsletter', 'threads', 'tiktok', 'youtube']);

/**
 * utm_source 쿼리가 있는 요청만 기록. 없으면 no-op (일반/검색 트래픽 제외).
 * @param {object} req  Vercel/Node request
 * @param {string} page 'article' | 'pepperit' | 'editorial' 등 렌더 대상
 */
async function logSocialInclick(req, page) {
  try {
    const q = req.query || {};
    const srcRaw = String(q.utm_source || '').toLowerCase();
    if (!srcRaw) return;
    if (isLikelyBot(req.headers['user-agent'])) return; // 크롤러 제외 (사람 지표만)
    const src = SRC_WHITELIST.has(srcRaw) ? srcRaw : 'other';
    const path = String(req.url || '').split('?')[0].slice(0, 300);
    const { error } = await supabaseAdmin.from('social_inclicks').insert({
      src: src,
      campaign: String(q.utm_campaign || '').slice(0, 80) || null,
      page: String(page || 'other').slice(0, 40),
      path: path,
      referrer_path: sanitizeReferrer(req.headers['referer'] || req.headers['referrer']),
      device_type: detectDeviceType(req.headers['user-agent']),
      ip_hash: hashIp(extractClientIp(req)),
    });
    if (error) console.warn('[social-inclick] insert failed', error.message);
  } catch (e) {
    console.warn('[social-inclick] threw', e && e.message);
  }
}

module.exports = { logSocialInclick };
