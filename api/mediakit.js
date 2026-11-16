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
/* 2026-11-16(3차) — 또 같은 일이 났다. 설정(site_settings.business_page)과 이 폴백이
   둘 다 **휴지통에 들어간 파일**을 가리키고 있었다: KO 1wjL9Qe…('미디어키트 2026_09',
   8/24), EN 1rjZPyD…('MEDIA KIT (ENG)_ May_2026', 7/29). 도메니코는 새 키트를 올리고
   옛 파일을 휴지통에 넣었는데, 드라이브는 파일을 바꾸면 ID 가 바뀌므로 사이트가 따라가지
   못한다. 소유자는 로그인 상태에서 휴지통 파일도 그냥 열려서 '옛 키트가 뜬다' 로 보이고,
   광고주에게는 '소유자의 휴지통에 있습니다' 가 뜬다 — 광고주 대면 경로다.
   7/29 에도 같은 사고였고 그때는 '링크가 또 바뀌면 두 곳을 함께 고칠 것' 이라는 주석만
   남겼다. 주석은 재발을 막지 못했다. 그래서 이번엔 매일 점검(api/cron/mediakit-link-watch.js)
   을 붙였다 — 링크가 죽으면 사람이 알게 된다. */
/* 사이트가 실제로 내보내는 파일. 봇 응답·사람 리다이렉트가 같은 것을 가리킨다. */
const PUBLIC_PDF = {
  ko: '/media-kit/PAP-Magazine-Media-Kit-2026-KO.pdf',
  en: '/media-kit/PAP-Magazine-Media-Kit-2026-EN.pdf',
};

const DEFAULT_LINKS = {
  ko: 'https://drive.google.com/file/d/1dAV7cMwsDOuyLucU_ponpLxwwuJmxCuf/view?usp=sharing',
  en: 'https://drive.google.com/file/d/1SXhmU1FDYvnXqVuv_sqylJvqyKT_ImE1/view?usp=sharing',
};

/* 2026-11-16 — 외부 URL 허용 호스트 검사(safeExternal·ALLOWED_HOSTS)를 지웠다.
   목적지가 바깥 링크였을 때는 "허용 호스트만" 이라는 방어가 필요했지만, 이제
   목적지는 코드 안의 경로(PUBLIC_PDF) 하나뿐이다. 외부 URL 을 아예 받지 않으므로
   오픈 리다이렉터가 될 길이 없다 — 검사할 것이 없어서 지운 것이지, 느슨해진 게
   아니다. 쓰지 않는 안전장치를 남겨두면 검사하고 있다는 착시만 준다. */

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

  /* 2026-08-25 (GSC 5xx 162건 실측) — 봇 판별을 레이트리미터보다 먼저 한다.
     구글봇이 /mediakit/ko/brand_* 를 한꺼번에 크롤하면 60/분 한도에 걸려 429 를
     받는데, GSC 는 429 를 "서버 오류(5xx)"로 분류한다. 크롤 예산도 같이 깎인다.
     봇은 어차피 로그를 안 남기므로 리미터를 태울 이유가 없다 — 즉시 302.
     사람 트래픽의 한도·기록 로직은 그대로다. */
  const uaEarly = req.headers['user-agent'];
  const uaIsBot = isLikelyBot(uaEarly) || isBot(uaEarly);

  // 봇/스크립트의 로그 오염 방지 (ig-out 과 동일 한도) — 사람만 태운다
  if (!uaIsBot && await rateLimitStrict(req, res, { limit: 60, windowMs: 60000 }, 'mediakit')) return;

  const { lang, src } = readParams(req);

  /* 목적지: 우리가 호스팅하는 PDF (2026-11-16, 도메니코 "미디어키트를 누르면 pdf 가
     뜨게 하면 되지 않아?").
     종전에는 관리자 설정의 드라이브 링크로 보냈다. 그 구조가 두 번 터졌다(7/29 · 11/16):
     드라이브는 파일을 교체하면 ID 가 바뀌는데, 새 키트를 올리고 옛 파일을 휴지통에
     넣으면 사이트는 죽은 ID 를 계속 가리킨다. 소유자는 로그인 상태라 그 파일이 그냥
     열려서 증상이 보이지도 않는다.
     이제 파일은 frontend/media-kit/ 에 우리가 들고 있다. 바깥 ID 에 의존하지 않으므로
     그 사고 경로 자체가 없어지고, 브라우저에서 바로 열린다(vercel.json 의 inline 헤더).
     계측은 그대로다 — 이 핸들러를 거치는 것이 목적이고, 목적지만 바뀌었다.
     설정의 드라이브 링크는 지우지 않았다. 도메니코가 직접 보내는 공유용으로 남아
     있고, 매일 점검(api/cron/mediakit-link-watch.js)이 그쪽도 함께 본다. */
  const dest = HOME_URL + PUBLIC_PDF[lang];

  /* 크롤러는 리다이렉트하지 않는다 (2026-09-08, GSC 서버 오류 760건 실측).
     8/25 에 봇을 리미터 앞에서 302 로 보냈더니 5xx 가 162 → 760 으로 늘었다.
     Vercel 로그는 구글 실시간 테스트(08:47:53Z)에 정확히 302 를 줬는데 GSC 는
     "서버 오류(5xx)" 라고 했다 — 구글이 302 를 따라간 곳(drive.google.com)이
     크롤러를 거부한 것이고, 그 결과가 우리 URL 의 성적으로 찍힌다. 남의 5xx 를
     우리가 뒤집어쓰는 구조. 봇에게는 리다이렉트 대신 **작은 200 + noindex** 를
     준다: 크롤러는 색인 대상 아님을 알고 물러나고(크롤 예산 회수), 5xx 는 사라진다.
     사람 경로(아래)는 그대로 302 → 미디어킷 파일. */
  if (uaIsBot) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">'
      + '<title>PAP Magazine Media Kit</title></head><body>'
      + '<p>PAP Magazine media kit is available to advertisers on request.</p>'
      + '<p><a href="' + HOME_URL + '/business">Advertise with PAP Magazine</a></p>'
      /* 2026-10-15 — 봇에게도 읽을 거리를 준다: 공개 정적 PDF 링크 (frontend/media-kit/).
       * 2026-11-16 영문판도 공개(11/15 신규본). 언어와 무관하게 두 개를 다 건다. */
      + '<p><a href="' + HOME_URL + PUBLIC_PDF.ko + '">PAP Magazine Media Kit 2026 (PDF, Korean)</a></p>'
      + '<p><a href="' + HOME_URL + PUBLIC_PDF.en + '">PAP Magazine Media Kit 2026 (PDF, English)</a></p>'
      + '</body></html>');
  }
  const ua = uaEarly;

  /* 리퍼러 없는 요청은 기록하지 않는다 (2026-07-30 오염 실측 후 추가).
   *
   * UA 필터를 통과하는 크롤러가 있다. 브랜드 페이지가 색인되기 시작하자
   * 21건이 들어왔는데 전부 봇이었다 — 판별 근거:
   *   · 11:09:36~43 (7초)에 13건, 서로 다른 브랜드 페이지에서 1건씩
   *   · IP 가 13개 전부 다름 → IP 스로틀로는 못 막는다(프록시 풀)
   *   · UA 는 전부 동일한 평범한 Chrome 데스크톱 → UA 로도 못 막는다
   *   · 그런데 21건 전부 referer 가 없다
   *
   * 사람이 /brand/:id 의 "미디어킷 받기" 를 누르면 referer 가 남는다. 반대로
   * 링크만 수집해 직접 때리는 크롤러는 referer 가 없다. 이게 이 트래픽에서
   * 사람과 기계를 가르는 유일하게 신뢰할 수 있는 신호였다.
   *
   * 대가: 북마크·카톡·QR·주소 직접 입력 등 정당한 무-리퍼러 유입도 집계에서
   * 빠진다. 그건 감수한다 — 이 지표의 용도는 "어느 브랜드 페이지가 영업 기회를
   * 만드는가" 판단이고, 봇 21건이 섞이면 판단 자체가 불가능해진다. 적게 세는
   * 것이 틀리게 세는 것보다 낫다.
   * (IG 바이오·DM 유입은 src 로 구분되므로 ALLOW_NO_REFERER_SRCS 에 둔다.) */
  const ALLOW_NO_REFERER_SRCS = new Set(['ig_bio', 'dm', 'ig_story', 'qr']);
  const ref = req.headers['referer'] || req.headers['referrer'];
  if (!ref && !ALLOW_NO_REFERER_SRCS.has(src) && !src.startsWith('ig_post_')) {
    console.log('[mediakit] no-referer skip', { src, lang });
    return res.redirect(302, dest);
  }

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

/* 2026-11-16 — 매일 점검(api/cron/mediakit-link-watch.js)이 이 폴백도 같이 열어 본다.
   설정과 폴백이 함께 썩는 것이 7/29·11/16 두 번의 사고였다. */
module.exports.DEFAULT_LINKS = DEFAULT_LINKS;
module.exports.PUBLIC_PDF = PUBLIC_PDF;
