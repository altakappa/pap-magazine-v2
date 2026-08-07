/**
 * 한국 유입·참여 표면 — tests/kr-growth-surface.test.js (2026-08-07 신설)
 *
 * 왜 만들었나 ────────────────────────────────────────────────────────
 * 한국 시장 코드 전수 조사에서 나온 숫자:
 *
 *     웹 → 인스타 아웃클릭   16,016회
 *     외부 → 웹 인클릭          120회   (그나마 전부 src='other')
 *     커뮤니티 글·댓글·좋아요   역대 0건
 *     카카오톡 공유 코드         0건
 *     네이버 유입 측정 도구      0개
 *
 * 여기서 지키는 것 (A묶음):
 *   ① 카카오 공유 — 키가 없으면 버튼도 안 그린다 (죽은 버튼 금지)
 *   ② 공유 링크에만 utm — canonical 은 절대 오염시키지 않는다
 *   ③ 네이버 블로그 백링크에 utm — 없으면 유입이 영원히 0으로 집계된다
 *   ④ 인바운드 계측이 에디토리얼에도 붙는다 (주력 콘텐츠가 빠져 있었다)
 *   ⑤ 소스 화이트리스트가 실제 우리 채널을 덮는다
 *   ⑥ 네이버 애널리틱스도 키 게이트 — 미설정 시 스크립트 미주입
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const seo = R('api/_lib/seoRenderer.js');

console.log('\n[1] 카카오 공유 — 공용 부품이 그린다');
{
  /* 2026-08-07 갱신 — 예전엔 SSR 이 버튼과 SDK 를 직접 그렸다. 그러면
     **사이트 안에서 클릭해 들어온 사람(SPA)에게는 버튼이 없다.**
     도메니코가 "MORE ARTICLES·FAQ 가 안 뜬다" 고 한 것과 같은 뿌리다.
     이제 두 화면이 /pap-engage.js 를 같이 쓴다. */
  const eng = R('frontend/pap-engage.js');
  t('공용 부품이 존재한다', eng.length > 1000);
  t('SSR 이 공용 부품을 부른다', /\/pap-engage\.js/.test(seo));
  t('SSR 이 인라인으로 카카오를 그리지 않는다', !/papKakaoShare/.test(seo));
  t('키를 프런트로 넘긴다', /__PAP_KAKAO_JS_KEY/.test(seo));
  t('키가 없으면 버튼을 안 보여준다', /if \(!key \|\| !kkoBtn\) return;/.test(eng));
  t('SDK 무결성 해시 유지', /integrity = 'sha384-/.test(eng));
  t('SDK 로드 실패를 삼킨다 (CSP 차단 대비)', /s\.onerror/.test(eng));
  t('공유 실패가 페이지를 안 망가뜨린다', /공유 실패가 페이지를 망가뜨리지 않는다/.test(eng));

  const cfg = R('api/content/config.js');
  t('공개 설정 창구가 있다 (SPA 는 서버가 값을 못 심는다)', /kakaoJsKey/.test(cfg));
  t('공개 키만 나간다 — 어드민·REST 키 금지', !/ADMIN|REST_API|SECRET/.test(cfg));
  t('CDN 에 캐시한다 (조회수만큼 함수가 돌면 안 된다)', /s-maxage=3600/.test(cfg));
}

console.log('\n[1-2] 두 화면이 갈라지지 않는다');
{
  const spa = R('frontend/pap-content-article.js');
  const arts = R('frontend/articles.html');
  const idx = R('frontend/index.html');
  t('SPA 렌더러가 참여 블록을 붙인다', /window\.PapEngage\.mount\(engHost/.test(spa));
  t('SPA 가 기사 uuid 를 넘긴다', /id:a\._api_id/.test(spa));
  for (const [n, h] of [['articles.html', arts], ['index.html', idx]]) {
    t(n + ' 에 마운트 지점이 있다', /id="papEngageMount"/.test(h));
    t(n + ' 이 공용 부품을 로드한다', /pap-engage\.js/.test(h));
    /* 아래에 두면 인스타로 나간 뒤라 아무도 안 본다 */
    t(n + ' 에서 참여가 IG CTA 보다 위', h.indexOf('papEngageMount') < h.indexOf('artIgPostCta'));
  }
}

console.log('\n[2] 공유 링크에만 utm — canonical 은 그대로');
{
  t('kakaoShareUrl 을 따로 만든다', /const kakaoShareUrl = canonical \+/.test(seo));
  t('utm_source=kakao 를 붙인다', /utm_source=kakao&utm_medium=share/.test(seo));
  /* canonical 에 utm 이 섞이면 색인이 갈린다 — 이 파일에서 제일 위험한 실수 */
  t('canonical 정의에 utm 이 없다', !/const canonical = [^\n]*utm_/.test(seo));
  t('<link rel=canonical> 이 kakaoShareUrl 을 쓰지 않는다',
    !/rel="canonical"[^>]*kakaoShareUrl/.test(seo));
  t('og:url 도 오염되지 않는다', !/og:url[^>]*kakaoShareUrl/.test(seo));
}

console.log('\n[3] 네이버 블로그 백링크 계측');
{
  const nb = R('api/admin/naver-blog-draft.js');
  t('원문 링크에 utm_source=naver 가 붙는다', /utm_source=naver&utm_medium=blog/.test(nb));
  t('그 링크가 본문에 실제로 들어간다', /body \+=[\s\S]{0,120}artUrl/.test(nb));
}

console.log('\n[4] 인바운드 계측 범위');
{
  const ed = R('api/seo/editorial/[slug].js');
  const ar = R('api/seo/article/[slug].js');
  t('에디토리얼 SSR 이 계측한다 (주력 콘텐츠였는데 빠져 있었다)',
    /logSocialInclick\(req, 'editorial'\)/.test(ed));
  t('에디토리얼이 모듈을 실제로 require 한다', /require\('\.\.\/\.\.\/_lib\/socialInclick'\)/.test(ed));
  t('기사 SSR 은 그대로 유지', /logSocialInclick\(req, 'article'\)/.test(ar));
  t('렌더보다 먼저 부른다 (렌더 후면 리턴돼서 안 불린다)',
    ed.indexOf("logSocialInclick(req, 'editorial')") < ed.indexOf("renderSeoHtml('editorial'"));
}

console.log('\n[5] 소스 화이트리스트가 우리 채널을 덮는다');
{
  const si = R('api/_lib/socialInclick.js');
  for (const src of ['naver', 'kakao', 'threads', 'x', 'ig', 'newsletter', 'tiktok', 'youtube']) {
    t("'" + src + "' 가 화이트리스트에 있다", new RegExp("'" + src + "'").test(si.split('SRC_WHITELIST')[1].split(']')[0] || ''));
  }
  t('없는 소스는 other 로 떨어진다 (버리지 않는다)', /: 'other'/.test(si));
}

console.log('\n[6] 네이버 애널리틱스');
{
  t('NAVER_ANALYTICS_ID 를 env 에서 읽는다', /const NAVER_ANALYTICS_ID = process\.env\.NAVER_ANALYTICS_ID \|\| ''/.test(seo));
  t('미설정이면 스크립트를 안 넣는다', /\$\{NAVER_ANALYTICS_ID \? `/.test(seo));
  t('wcslog 를 부른다', /wcs\.naver\.net\/wcslog\.js/.test(seo));
  t('계정 id 를 wcs_add.wa 에 넣는다', /wcs_add\.wa = /.test(seo));
  t('유입 도메인을 선언한다', /wcs\.inflow\('pap-magazine\.com'\)/.test(seo));
}

console.log('\n[7] CSP — 스크립트가 실제로 로드될 수 있는가');
{
  /* 2026-08-07 실사고: 키를 넣고 배포까지 했는데 버튼이 안 눌렸다.
     script 태그는 DOM 에 있었지만 window.Kakao / window.wcs 가 undefined —
     CSP script-src 화이트리스트에 두 도메인이 없어 브라우저가 막았다.
     '코드가 있다' 와 '코드가 돈다' 사이에 CSP 가 있다. */
  const v = JSON.parse(R('vercel.json'));
  const csp = (v.headers || []).flatMap((h) => h.headers || [])
    .filter((x) => /content-security-policy/i.test(x.key)).map((x) => x.value).join(' ');
  t('CSP 헤더가 실재한다', csp.length > 100);
  t('script-src 에 카카오 SDK 도메인', /t1\.kakaocdn\.net/.test(csp));
  t('script-src 에 네이버 wcslog 도메인', /wcs\.naver\.net/.test(csp));
  t('connect-src 에 카카오 API', /kapi\.kakao\.com/.test(csp));
  t('공유 팝업 도메인 허용', /sharer\.kakao\.com/.test(csp));
  t('기존 결제·인스타 허용이 그대로', /portone/.test(csp) && /instagram/.test(csp));
  t('object-src none 유지 (보안 완화 아님)', /object-src 'none'/.test(csp));
  t('frame-ancestors none 유지', /frame-ancestors 'none'/.test(csp));
}

console.log('\n[8] 회귀 — 기존 표면이 안 깨졌다');
{
  t('핀터레스트 버튼은 그대로', /class="pin-btn"/.test(seo));
  t('IG 퍼널 CTA 는 그대로', /api\/ig-out\?src=/.test(seo));
  t('JSON-LD 3종 주입 유지', (seo.match(/application\/ld\+json/g) || []).length >= 3);
  t('hreflang x-default 유지', /x-default/.test(seo));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ kr-growth-surface tests FAILED'); process.exit(1); }
console.log('✅ kr-growth-surface tests passed');
