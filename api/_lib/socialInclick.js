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

/* 화이트리스트 폐기 (2026-08-10) ────────────────────────────────────────
   2026-08-07 에 'threads' 를 목록에 "추가"해서 고쳤는데, 같은 사고가 또 났다.
   실측(8/4~8/10): 유입 93건 중 67건(72%)이 다시 'other'. 리퍼러 없음 +
   모바일 + 고유 방문자 33명 = 앱 내부 브라우저(인스타·카톡 등)에서 온
   진짜 사람인데, 어느 앱인지 우리가 못 적었다.

   근본 원인은 목록이 짧은 게 아니라 **모르는 값을 만나면 원본을 버린다**는
   설계다. 버리는 순간 영영 알 수 없다. 목록에 값을 채워 넣는 방식은 새
   출처가 생길 때마다 같은 사고를 반복한다 — 우리는 다음에 뭐가 올지 모른다.

   그래서 목록을 없애고 '정규화만' 한다. 모르는 값이어도 그대로 남긴다.
   화이트리스트의 원래 목적(쓰레기 값 차단)은 글자·길이 제한으로 충분하다.

   ALIASES 는 같은 출처가 두 이름으로 갈리는 것만 합친다(instagram=ig).
   이건 '모르는 값을 버리는' 것과 다르다 — 아는 값을 하나로 모으는 것이다. */
const ALIASES = new Map([
  ['instagram', 'ig'], ['insta', 'ig'], ['ig_story', 'ig'], ['igstory', 'ig'],
  ['twitter', 'x'], ['t_co', 'x'],
  ['thread', 'threads'],
  ['kakaotalk', 'kakao'], ['kakao_talk', 'kakao'],
  ['naverblog', 'naver'], ['naver_blog', 'naver'], ['blog_naver', 'naver'],
  ['yt', 'youtube'], ['youtu_be', 'youtube'],
  ['mail', 'newsletter'], ['email', 'newsletter'],
]);

/**
 * utm_source 를 저장 가능한 형태로 정규화한다. **모르는 값도 버리지 않는다.**
 *
 * 규칙: 소문자 → 영숫자/밑줄만 남김(그 외는 밑줄) → 앞뒤 밑줄 정리 → 24자 컷
 *       → 별칭 통합. 남는 게 없으면 그때만 'other'.
 *
 * @param {string} raw 원본 utm_source
 * @returns {string} 정규화된 출처 (빈 값이면 'other')
 */
function normalizeSrc(raw) {
  const t = String(raw == null ? '' : raw).toLowerCase().trim()
    .replace(/[^a-z0-9_]+/g, '_')   // 한글·이모지·공백·기호 → 밑줄
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24)
    .replace(/_$/, '');             // 컷 뒤 꼬리 밑줄 제거
  if (!t) return 'other';
  return ALIASES.get(t) || t;
}

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
    const src = normalizeSrc(srcRaw);
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

module.exports = { logSocialInclick, normalizeSrc };
