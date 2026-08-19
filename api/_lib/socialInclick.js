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
const { aiReferralPlatform, refererHost, aiCrawlerInfo } = require('./aiTraffic');

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
  // 2026-08-17 — AI 검색 유입이 리퍼러 도메인 그대로(chatgpt_com 등) 저장돼
  // 채널이 갈라졌다. 하나로 모은다 (주간 성적표에서 'chatgpt' 한 줄로).
  ['chatgpt_com', 'chatgpt'], ['chat_openai_com', 'chatgpt'], ['openai', 'chatgpt'],
  // 2026-08-17 — 리퍼러 도메인 그대로 오는 경우 대비 (핀터레스트·플립보드)
  ['pinterest_com', 'pinterest'], ['pin_it', 'pinterest'],
  ['flipboard_com', 'flipboard'], ['flip_it', 'flipboard'],
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
    const headers = req.headers || {};
    const refRaw = headers['referer'] || headers['referrer'];
    const srcRaw = String(q.utm_source || '').toLowerCase();

    /* AI 리퍼러 폴백 (2026-08-19) ────────────────────────────────────
       챗GPT 는 링크에 utm_source=chatgpt.com 을 붙여 준다. 그래서 8/10 부터
       141건이 이 표에 들어와 있었다. 그런데 **퍼플렉시티·제미나이·클로드·
       코파일럿은 utm 을 안 붙인다.** Referer 헤더만 온다.
       'utm 없으면 무시' 규칙을 그대로 두면 그 유입은 영원히 0 으로 보인다.
       채널이 죽은 것과 계측이 없는 것을 구분 못 하는 상태 — 2026-08-12 에
       인클릭 비콘을 만들게 한 것과 **똑같은 구멍**이다.

       utm 이 있으면 utm 이 이긴다. 챗GPT 처럼 둘 다 보내는 경우 두 번
       세지 않기 위해서다. */
    const aiPlatform = srcRaw ? null : aiReferralPlatform(refRaw);
    if (!srcRaw && !aiPlatform) return;

    /* 봇 제외 — 두 목록을 함께 본다 (2026-08-19 하네스가 잡은 구멍).
       clickGuard.isLikelyBot 은 UA 에 'bot|crawl|spider…' 가 들어야 잡는다.
       그런데 **ChatGPT-User·Perplexity-User·Claude-User 에는 그 단어가 없다.**
       그대로 두면 "사람이 AI 에서 넘어왔다" 칸에 봇이 섞인다. 우리 AI 크롤러
       목록으로 한 번 더 거른다. 이 봇들은 ai_crawl_daily 쪽에 따로 적힌다. */
    if (isLikelyBot(headers['user-agent'])) return;
    if (aiCrawlerInfo(headers['user-agent'])) return;
    const src = srcRaw ? normalizeSrc(srcRaw) : aiPlatform;
    const path = String(req.url || '').split('?')[0].slice(0, 300);
    const { error } = await supabaseAdmin.from('social_inclicks').insert({
      src: src,
      campaign: String(q.utm_campaign || '').slice(0, 80) || null,
      page: String(page || 'other').slice(0, 40),
      path: path,
      referrer_path: sanitizeReferrer(refRaw),
      // 호스트를 따로 남긴다 — sanitizeReferrer 는 경로만 남기고 호스트를 버려서
      // "어느 AI 에서 왔나" 를 저장된 데이터로 되짚을 수 없었다 (132 마이그레이션).
      referrer_host: refererHost(refRaw),
      device_type: detectDeviceType(headers['user-agent']),
      ip_hash: hashIp(extractClientIp(req)),
    });
    if (error) console.warn('[social-inclick] insert failed', error.message);
  } catch (e) {
    console.warn('[social-inclick] threw', e && e.message);
  }
}

module.exports = { logSocialInclick, normalizeSrc };
