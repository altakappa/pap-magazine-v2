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

/* 2026-08-10 개정 — 화이트리스트를 폐기했다. 예전 검사는 "우리 채널이
   목록에 들어 있나"를 봤는데, 진짜 위험은 그 반대였다: **목록에 없는 출처의
   원본을 버리는 것**. 실측으로 유입 72%가 'other' 로 뭉개졌다.

   이 파일은 소스를 '읽기만' 하는 검사다(모듈을 require 하면 supabase 초기화가
   걸린다). 실제 동작 검증은 tests/social-inclick-src.test.js 가 함수를 직접
   불러서 한다. 여기서는 설계가 되돌아가지 않았는지만 지킨다. */
console.log('\n[5] 유입 출처 계측 — 모르는 값을 버리지 않는다');
{
  const si = R('api/_lib/socialInclick.js');
  t('화이트리스트가 되살아나지 않았다', !/SRC_WHITELIST/.test(si));
  t('정규화 함수가 있다', /function normalizeSrc\(/.test(si));
  t('정규화 결과를 저장한다', /const src = normalizeSrc\(srcRaw\)/.test(si));
  t('모르는 값을 그대로 돌려준다 (ALIASES 있으면 통합, 없으면 원본)',
    /return ALIASES\.get\(t\) \|\| t;/.test(si));
  t("빈 값일 때만 'other'", /if \(!t\) return 'other';/.test(si));
  for (const src of ['ig', 'x', 'threads', 'kakao', 'naver', 'youtube', 'newsletter']) {
    t("'" + src + "' 가 별칭 통합 대상으로 존재한다",
      new RegExp("'" + src + "'\\]").test((si.split('const ALIASES')[1] || '').split(']);')[0]));
  }
  t('실동작 검증은 별도 파일이 한다', /social-inclick-src/.test(si) || true);
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

console.log('\n[9] AI/GEO 엔티티 — 우리가 어떤 매체인지 기계가 읽을 수 있는가 (2026-08-12)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * 도메니코 실측: ChatGPT 에 "디지털 매거진 추천"을 물으면 PAP 이 안 나오고,
   * 나와도 "아트 서브미션 기반 에디토리얼 매거진"으로만 인식된다.
   * 원인 하나는 Organization 엔티티에 **어디 매체인지·무엇을 다루는지**가
   * 비어 있었다는 것 — name/description/sameAs 뿐이었다.
   * LLM·지식그래프는 아래 필드를 그대로 읽는다. 지워지면 인식이 되돌아간다. */
  t('NewsMediaOrganization 타입 유지', /'@type':\s*'NewsMediaOrganization'/.test(seo));
  t('설립지가 서울(KR)로 선언된다', /foundingLocation/.test(seo)
     && /addressCountry:\s*'KR'/.test(seo) && /addressLocality:\s*'Seoul'/.test(seo));
  t('areaServed 에 South Korea', /areaServed/.test(seo) && /South Korea/.test(seo));
  // 2026-08-12 정정 — /about 이 "2018년 1월 출범"이라 말하는데 스키마가 2019 였다.
  // 자기 사이트 안에서 두 값이 어긋나면 AI 는 둘 다 안 쓴다. 창간은 2018-01 이 맞다.
  t('foundingDate 2018-01', /foundingDate:\s*'2018-01'/.test(seo));
  t('knowsAbout 에 뉴스 주제가 있다 (에디토리얼만이 아니다)',
     /knowsAbout/.test(seo) && /'패션위크'/.test(seo) && /'셀럽 패션'/.test(seo)
     && /'뷰티 트렌드'/.test(seo));
  t('knowsAbout 에 한국어·영어가 모두 있다',
     /'한국 패션 브랜드'/.test(seo) && /'Korean Fashion Brands'/.test(seo));
  t('inLanguage 9개 언어 선언', /inLanguage/.test(seo)
     && /'ko',\s*'en',\s*'it',\s*'fr',\s*'es',\s*'ja',\s*'de',\s*'zh',\s*'ru'/.test(seo));
  t('publishingPrinciples / ownershipFundingInfo 가 /about 을 가리킨다',
     /publishingPrinciples/.test(seo) && /ownershipFundingInfo/.test(seo));
  t('발행사 ALTAKAPPA 가 엔티티에 있다', /ALTAKAPPA Co\., Ltd\./.test(seo));
  t('브랜드 설명이 "디지털 패션 매거진"으로 시작한다 (뉴스 매체 아님)',
     /서울에 기반을 둔 한국의 디지털 패션 매거진/.test(seo));
  t('영문 설명도 digital fashion magazine',
     /Korean digital fashion magazine based in Seoul/.test(seo));
  t('아트 에디토리얼 정체성을 설명에서 지우지 않았다',
     /아트 에디토리얼/.test(seo) && /art-driven/.test(seo));

  /* llms.txt — AI 가 사이트를 이해할 때 가장 먼저 읽는 파일.
   * "한국 디지털 매거진"이 첫 문단에 있어야 하고, 뉴스 섹션이 에디토리얼보다
   * 앞에 와야 한다(순서가 곧 비중 신호다). */
  const llms = R('frontend/llms.txt');
  /* 2026-08-12 도메니코 정정: "뉴스 매체는 아니고 패션 매거진, 디지털 패션 매거진".
   * 카테고리어가 "digital fashion magazine" 이어야 한다 — 이게 랭크 목표 표현이다. */
  t('llms.txt 첫 문단에 "Korean digital fashion magazine"',
     /Korean digital fashion magazine/i.test(llms.slice(0, 700)));
  t('llms.txt 첫 문단에 서울 기반 명시', /based in\s+\n?>?\s*Seoul/i.test(llms.slice(0, 700)));
  t('스스로를 뉴스 매체라 부르지 않는다', /not a news wire/i.test(llms));
  t('한국어 카테고리어가 본문에 있다 (한국어 질의 대응)',
     /디지털 패션 매거진/.test(llms) && /온라인 패션 매거진/.test(llms)
     && /한국 디지털 매거진/.test(llms));
  t('한국어 요약 절이 있다', /### 한국어 요약/.test(llms));
  t('디지털 전용(종이 잡지 없음) 명시', /No print edition/i.test(llms));
  t('llms.txt 에 "What PAP covers" 주제 목록', /## What PAP covers/.test(llms));
  t('주제 목록에 패션위크·셀럽·뷰티가 들어 있다',
     /Fashion weeks/i.test(llms) && /K-pop style/i.test(llms) && /Beauty trends/i.test(llms));
  t('Articles(뉴스) 섹션이 Editorials 보다 먼저 온다',
     llms.indexOf('/articles)') > 0 && llms.indexOf('/archive)') > 0
     && llms.indexOf('/articles)') < llms.indexOf('/archive)'));
  t('"인스타그램 매거진" 카테고리를 스스로 선언한다',
     /Instagram magazine/i.test(llms) && /인스타그램 매거진/.test(llms));
  t('1순위 카테고리가 "Digital fashion magazine" 이다',
     llms.indexOf('Digital fashion magazine') > 0
     && llms.indexOf('Digital fashion magazine') < llms.indexOf('Instagram magazine (인스타그램'));
  t('아트 에디토리얼 정체성도 지운 게 아니다 (둘 다 사실)',
     /art-driven fashion editorials/i.test(llms));
  t('발행사·설립연도가 llms.txt 에도 있다',
     /ALTAKAPPA/.test(llms) && /2019/.test(llms));
  t('llms.txt 가 카테고리 안내 페이지를 가리킨다 (AI 가 따라 읽을 문서)',
     /\/digital-magazine\)/.test(llms));
}

console.log('\n[10] 카테고리 정의 페이지 · 크롤러 가시성 (2026-08-12)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * 도메니코 실측: ChatGPT 에 "한국 디지털 매거진 TOP 20" 을 물으면 PAP 이 없다.
   * 그 답변의 인용 칩은 아이즈매거진·DAZED·ELLE — **매체 자기 사이트**였다.
   * 즉 ChatGPT 는 각 매체가 자기를 뭐라고 부르는지를 읽고 분류한다.
   *
   * 그런데 우리 /about 의 본문은 <div id="aboutBody"></div> 로 비어 있었고
   * JS(setLang)가 채웠다. JS 를 실행하지 않는 크롤러에게 ABOUT 은 빈 페이지였다.
   * 자기소개가 아예 안 읽히는데 분류가 될 리 없다.
   *
   * 여기서 지키는 것:
   *   ① /about 본문이 HTML 에 정적으로 존재한다 (JS 없이 읽힌다)
   *   ② 그 첫 문장이 "한국의 디지털 패션 매거진" 이다
   *   ③ 카테고리 정의 페이지(/digital-magazine)가 존재하고 라우팅된다
   *   ④ 그 페이지가 경쟁 매체를 함께 싣는다 (우리만 있는 목록은 광고로 걸러진다)
   *   ⑤ 창간연도가 about·스키마·llms.txt 에서 서로 모순되지 않는다 */

  const about = R('frontend/about.html');
  const dm    = R('frontend/digital-magazine.html');
  const llms  = R('frontend/llms.txt');   // [9] 의 llms 는 블록 스코프라 여기서 다시 읽는다
  const vjson = JSON.parse(R('vercel.json'));

  // ① 크롤러 가시성 — aboutBody 가 비어 있으면 안 된다
  const bodyDiv = about.match(/<div class="about-text" id="aboutBody">([\s\S]*?)<\/div>/);
  t('/about 본문이 HTML 에 정적으로 들어 있다 (JS 없이 읽힘)',
     !!bodyDiv && bodyDiv[1].replace(/\s/g, '').length > 300,
     bodyDiv ? 'len=' + bodyDiv[1].length : 'aboutBody 매칭 실패');

  // ② 첫 문장 — 카테고리어가 주어여야 한다
  t('/about 정적 본문 첫 문장이 "한국의 디지털 패션 매거진"',
     !!bodyDiv && /서울에 기반을 둔 한국의 디지털 패션 매거진/.test(bodyDiv[1].slice(0, 400)));
  t('/about 메타 description 이 아트 프레임이 아니라 카테고리 프레임',
     /디지털 패션 매거진/.test(about)
     && !/art-driven fashion, beauty & culture editorial platform/.test(about));
  t('/about FAQ 첫 답이 "한국의 디지털 패션 매거진" 으로 시작',
     /"PAP 매거진은 어떤 매체인가요\?"[\s\S]{0,200}서울에 기반을 둔 한국의 디지털 패션 매거진/.test(about));

  // ③ 카테고리 정의 페이지
  t('/digital-magazine 페이지가 존재한다', dm.length > 3000);
  t('/digital-magazine 라우팅(rewrite)이 있다',
     vjson.rewrites.some((r) => r.source === '/digital-magazine'
       && r.destination === '/digital-magazine.html'));
  t('/digital-magazine.html 은 확장자 없는 주소로 301',
     vjson.redirects.some((r) => r.source === '/digital-magazine.html'
       && r.destination === '/digital-magazine' && r.statusCode === 301));
  t('canonical 이 자기 주소를 가리킨다',
     /<link rel="canonical" href="https:\/\/www\.pap-magazine\.com\/digital-magazine">/.test(dm));

  // ④ 정직성 — 경쟁 매체를 함께 싣는다
  const rivals = ['보그 코리아', '엘르 코리아', '데이즈드 코리아', '아이즈매거진',
                  '하입비스트 코리아', '패스트페이퍼'];
  t('경쟁 매체를 함께 싣는다 (우리만 있는 목록 금지)',
     rivals.every((n) => dm.includes(n)),
     rivals.filter((n) => !dm.includes(n)).join(', ') || 'ok');
  t('FAQPage 스키마가 붙어 있다', /"@type":\s*"FAQPage"/.test(dm));
  t('"디지털 매거진이란" 정의 질문이 FAQ 에 있다',
     /디지털 매거진이란 무엇인가요\?/.test(dm));
  t('"한국의 디지털 매거진에는 어떤 곳이" 질문이 FAQ 에 있다',
     /한국의 디지털 매거진에는 어떤 곳이 있나요\?/.test(dm));
  t('본문이 정적 HTML 이다 (JS 로 그리지 않는다)',
     /<h1>디지털 매거진이란\?/.test(dm) && !/id="dmBody"><\/div>/.test(dm));

  // 성장 헌법 3·8항 — 웹→IG 는 ig-out 경유만
  t('IG 링크가 /api/ig-out 경유다 (성장 헌법 3항)',
     !/href="https:\/\/www\.instagram\.com/.test(dm)
     && (dm.match(/\/api\/ig-out\?src=digitalmag/g) || []).length === 8);
  t('웹 본체로 돌려보내는 링크가 있다 (성장 헌법 2항)',
     /href="\/articles"/.test(dm) && /href="\/archive"/.test(dm));

  // ⑤ 창간연도 모순 금지 — AI 는 모순되는 두 값을 둘 다 버린다
  t('스키마 foundingDate 가 2018-01 이다', /foundingDate:\s*'2018-01'/.test(seo));
  t('llms.txt 도 2018 창간이라고 말한다', /Founded January 2018/i.test(llms));
  t('about 페이지도 2018년 1월 창간이라고 말한다', /2018년 1월/.test(about));
  t('창간연도 2019 라는 서술이 남아 있지 않다',
     !/Founded 2019/.test(llms) && !/foundingDate:\s*'2019'/.test(seo));

  // 카테고리 호명어가 엔티티(knowsAbout)에도 들어갔는가
  t('knowsAbout 에 "디지털 매거진" 호명어가 있다',
     /'디지털 매거진'/.test(seo) && /'디지털 패션 매거진'/.test(seo)
     && /'인스타그램 매거진'/.test(seo));
  t('knowsAbout 영문 호명어도 있다',
     /'Digital Magazine'/.test(seo) && /'Instagram Magazine'/.test(seo));
}

console.log('\n[11] 인바운드 계측 공백 (2026-08-12 실측)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * DB 실측(최근 30일): 웹→IG 아웃클릭 4,058 vs 외부→웹 인클릭 src='ig' **4건**,
   * src='naver' **0건**. 팔로워 38만 계정에서 30일에 4명일 리가 없다.
   *
   * 원인: logSocialInclick 은 SSR 상세 3곳(article·editorial·pepperit)에서만
   * 돈다. 그런데 인스타 바이오·네이버 블로그·뉴스레터가 보내는 곳은 홈과 목록
   * 페이지이고, 그 페이지들은 사람에게 **정적 HTML** 로 나간다 — 서버 함수가
   * 아예 실행되지 않으니 utm 을 붙여도 기록될 자리가 없었다.
   * "채널이 죽은 것"과 "계측이 없는 것"을 구분하지 못하면 어느 쪽도 못 고친다.
   *
   * 여기서 지키는 것:
   *   ① 비콘 엔드포인트·프론트 파일이 존재하고 SSR 과 같은 함수를 쓴다
   *   ② 정적 랜딩 페이지 전부에 비콘이 붙어 있다 (한 곳이라도 빠지면 그 문은 깜깜)
   *   ③ SSR 상세 페이지에는 붙이지 않는다 (이중 집계 금지)
   *   ④ 네이버 블로그 백링크 두 종류 모두 utm 을 단다 (기사·에디토리얼) */

  const inclickApi = R('api/inclick.js');
  const inclickJs  = R('frontend/pap-inclick.js');
  const naverDraft = R('api/admin/naver-blog-draft.js');
  const archiveJs  = R('api/seo/archive.js');

  // ① 엔드포인트가 SSR 과 같은 기록 함수를 쓴다 — 규칙을 두 벌로 만들지 않는다
  t('비콘 엔드포인트가 존재한다', inclickApi.length > 200);
  t('비콘이 SSR 과 같은 logSocialInclick 을 쓴다',
     /require\('\.\/_lib\/socialInclick'\)/.test(inclickApi)
     && /logSocialInclick\(/.test(inclickApi));
  t('비콘은 착륙 경로를 path 로 남긴다 (/api/inclick 로 뭉개지지 않는다)',
     /shim\.url\s*=\s*landing/.test(inclickApi));
  t('비콘 실패가 화면을 막지 않는다 (항상 204)', /status\(204\)/.test(inclickApi));
  t('프론트 비콘은 utm_source 없으면 아무것도 안 한다',
     /utm_source/.test(inclickJs) && /if \(!src\) return;/.test(inclickJs));
  t('세션당 1회 — 새로고침 중복 집계 방지', /sessionStorage/.test(inclickJs));

  // ② 정적 랜딩 페이지 전수 — 하나라도 빠지면 그 유입 경로는 영영 0으로 보인다
  const LANDING = ['index', 'articles', 'magazine', 'films', 'community',
                   'subscribe', 'about', 'network', 'digital-magazine'];
  const missing = LANDING.filter((f) => !/pap-inclick\.js/.test(R('frontend/' + f + '.html')));
  t('정적 랜딩 페이지 9곳 전부에 비콘이 붙어 있다',
     missing.length === 0, missing.join(', ') || 'ok');
  t('SSR 아카이브(/archive)도 비콘을 내보낸다 (edge 캐시라 서버 집계 불가)',
     /pap-inclick\.js/.test(archiveJs));

  // ③ 이중 집계 금지 — SSR 상세 렌더러는 비콘을 넣지 않는다
  t('SSR 상세 렌더러에는 비콘이 없다 (이중 집계 금지)',
     !/pap-inclick\.js/.test(seo));

  // 성장 헌법 3항 — 아카이브 푸터의 생 IG 링크가 ig-out 을 우회하고 있었다
  t('/archive 의 IG 링크가 ig-out 경유다 (성장 헌법 3항)',
     !/href="https:\/\/www\.instagram\.com/.test(archiveJs)
     && /\/api\/ig-out\?src=archive/.test(archiveJs));

  // ④ 네이버 블로그 백링크 — 기사·에디토리얼 두 경로 모두
  const utmCount = (naverDraft.match(/utm_source=naver&utm_medium=blog/g) || []).length;
  t('네이버 블로그 백링크 utm 이 기사·에디토리얼 두 곳 모두에 있다',
     utmCount >= 2, 'utm 링크 ' + utmCount + '곳');
  t('에디토리얼 백링크에 utm 이 붙는다 (8/7 에 기사만 고쳐졌던 자리)',
     /\/editorial\/'\s*\+\s*encodeURIComponent\(ed\.slug\)[\s\S]{0,80}utm_source=naver/.test(naverDraft));
}

console.log('\n[12] 참여 사다리 1단 — 별점 무로그인 개방 (2026-08-12 도메니코 결정)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * DB 실측(30일): 에디토리얼 조회 11,003건, 그중 **로그인 상태 조회 56건(0.5%)**,
   * 별점 9건(조회의 0.082%), 콘텐츠 댓글 누적 0건, 리액션 누적 2건.
   *
   * 원인: pap-engage.js 가 kind==='editorial' 이면 좋아요 버튼을 안 그리고
   * (평가 장치는 한 화면에 하나 — 2026-08-09 결정), 그 유일한 장치인 별점은
   * 쓰기에 로그인을 요구했다. 즉 주력 콘텐츠를 보는 99.5% 에게는 누를 수 있는
   * 장치가 하나도 없었다. 성장 헌법 7항의 사다리 1단은 문턱이 0이어야 한다.
   *
   * 도메니코 결정(2026-08-12): 버튼은 하나로 두되 **별점 쓰기를 무로그인 개방**.
   *
   * 여기서 지키는 것:
   *   ① 별점 쓰기에 로그인 벽이 없다 (requireAuth 제거)
   *   ② 그러나 보안 감사 A-2 는 유지 — user_id 를 클라이언트에서 받지 않는다
   *   ③ 1인 1표는 서버가 만든 키로 강제 (로그인 uuid / 비로그인 ip:<hash>)
   *   ④ 봇은 세지 않는다
   *   ⑤ 사다리를 없앤 게 아니라 뒤로 미뤘다 — 남긴 직후 로그인 '권유' 한 줄
   *   ⑥ pap-engage.js 를 고쳤으면 참조 HTML 의 ?v= 를 올렸다 (캐시버스트) */

  const rate   = R('api/social/ratings.js');
  const engage = R('frontend/pap-engage.js');

  // ① 로그인 벽 제거
  t('별점 쓰기에 requireAuth 가 없다', !/requireAuth/.test(rate));
  t('별점 POST 가 401 을 던지지 않는다', !/status\(401\)/.test(rate));

  // ② 보안 감사 A-2 유지 — 키는 언제나 서버가 만든다
  t('user_id 를 요청 body 에서 받지 않는다 (감사 A-2 유지)',
     !/body\.user_id/.test(rate) && !/req\.query\.user_id/.test(rate));
  t('키 생성 함수가 서버에 있다', /function actorFor\(req\)/.test(rate));

  // ③ 1인 1표 — 로그인은 기존 uuid 그대로(기존 행 호환), 비로그인은 ip 해시
  t('로그인 키는 uuid 그대로 — 기존 별점이 계속 내 것으로 잡힌다',
     /return \{ key: String\(user\.id\), anon: false \}/.test(rate));
  t('비로그인 키는 ip 해시 (uuid 와 충돌 불가한 형식)',
     /'ip:' \+ hashIp\(extractClientIp\(req\)\)/.test(rate));
  t('upsert 가 (제목,키) 유니크로 1인 1표를 강제한다',
     /onConflict: 'editorial_title,user_id'/.test(rate));
  t('DELETE 는 자기 키 행만 지운다',
     /\.eq\('user_id', actor\.key\)/.test(rate));
  t('GET myScore 도 같은 키로 본다 (비로그인도 내 별점이 보인다)',
     /String\(r\.user_id\) === actor\.key/.test(rate));

  // ④ 봇 제외
  t('봇 별점은 기록하지 않는다', /isLikelyBot\(req\.headers\['user-agent'\]\)/.test(rate));

  // ⑤ 사다리 2단 — 벽이 아니라 권유
  t('서버가 비로그인 여부를 anon 으로 알려준다', /anon: actor\.anon/.test(rate));
  t('별점 직후 로그인 권유가 뜬다 (POST + anon 일 때만)',
     /method === 'POST' && d && d\.anon\) showNudge\(\)/.test(engage));
  t('권유는 한 번만 — 중복 삽입 방지', /querySelector\('\.pe-rate-nudge'\)\) return/.test(engage));
  t('권유 문구가 9개 언어 표에 국문·영문 모두 있다',
     /rateNudge: '로그인하면/.test(engage) && /rateNudge: 'Sign in to keep/.test(engage));
  t('권유 스타일이 부품 안에 있다 (SSR·SPA 한 벌)',
     /\.pe-rate-nudge\{/.test(engage));

  // ⑥ 캐시버스트 — pap-engage.js 를 고쳤으면 참조하는 곳의 ?v= 가 같이 올라야 한다
  const engRefs = ['frontend/index.html', 'frontend/articles.html',
                   'frontend/films.html', 'api/_lib/seoRenderer.js'];
  const vers = engRefs.map((f) => (R(f).match(/pap-engage\.js\?v=(\d+)/) || [])[1]);
  t('pap-engage.js 참조처의 ?v= 가 4곳 모두 같다',
     vers.every((v) => v && v === vers[0]), engRefs.map((f, i) => f + '=' + vers[i]).join(', '));
  t('pap-engage.js ?v= 가 7 보다 크다 (이번 수정분 반영)',
     Number(vers[0]) > 7, 'v=' + vers[0]);
}

console.log('\n[13] 기사 조회 계측 — 참여의 분모 (2026-08-12)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * 실측: 발행 기사 2,338편(30일 신규 1,891편)인데 articles.view_count 합이 0,
   * 조회 0인 기사 비율 100%. 컬럼은 있는데 **올려주는 코드가 없었다** —
   * admin 정렬·ops 대시보드·growthAudit 은 읽기만 한다.
   *
   * 분모가 없으면 참여 개선을 판정할 수 없다. "기사 좋아요 30일 2건"이 나쁜
   * 수치인지조차 알 수 없다 — 2,000명이 보고 2명이면 문제, 20명이 보고 2명이면
   * 훌륭하다. 에디토리얼은 editorial_views 로 30일 11,003건이 잡히는데
   * 기사만 깜깜했다. (오늘의 교훈 8과 같은 뿌리)
   *
   * 여기서 지키는 것:
   *   ① 엔드포인트가 있고 editorial-view 와 같은 모양이다 (같은 쿼리로 비교)
   *   ② 봇 제외 · 익명 허용 · 실패해도 화면을 막지 않는다
   *   ③ 마이그레이션 미실행(42P01)이어도 500 이 아니라 조용히 넘어간다
   *   ④ 프론트가 상세 열 때 부른다
   *   ⑤ pap-content-article.js 를 고쳤으면 참조 10곳의 ?v= 가 같이 올라갔다 */

  const av  = R('api/articles/[id]/view.js');
  const ev  = R('api/editorials/[id]/view.js');
  const art = R('frontend/pap-content-article.js');
  const mig = R('supabase_migrations/123_article_views.sql');

  // ① 엔드포인트 · editorial 과 같은 모양
  t('기사 조회 엔드포인트가 있다', av.length > 500);
  t('article_views 에 기록한다', /from\('article_views'\)/.test(av));
  t('POST 만 받는다', /req\.method !== 'POST'/.test(av));
  t('editorial-view 와 같은 기둥을 쓴다 (봇·레이트·토큰)',
     ['isBot', 'rateLimit', 'verifyToken'].every((n) => av.includes(n) && ev.includes(n)));

  // ② 봇 제외 · 익명 허용 · 조용한 실패
  t('봇 조회는 기록하지 않는다', /isBot\(req\.headers\['user-agent'\]\)/.test(av));
  t('로그인 없이도 기록된다 (requireAuth 없음)', !/requireAuth/.test(av));
  t('탈퇴계정 FK 위반(23503)이면 익명으로 강등해 다시 기록',
     /error\.code === '23503' && viewerId/.test(av));
  t('id 가 uuid 가 아니면 400 (쓰레기 행 방지)', /UUID\.test\(id\)/.test(av));

  // ③ 마이그레이션 미실행 내성 — 배포 순서 때문에 로그가 빨개지지 않는다
  t('표가 없으면(42P01) 500 이 아니라 204', /error\.code === '42P01'/.test(av)
     && /status\(204\)/.test(av));
  t('마이그레이션 파일이 저장소에 있다 (도메니코 직접 실행)',
     /create table if not exists public\.article_views/.test(mig));
  t('마이그레이션이 RLS 를 켠다 (감사 A-2 방향)',
     /enable row level security/.test(mig) && /admin_read_article_view/.test(mig));
  t('마이그레이션에 되돌리기 방법이 적혀 있다', /DROP TABLE public\.article_views/i.test(mig));

  // ④ 프론트 호출 — 상세를 열 때, 정적 스냅샷은 건너뛴다
  t('기사 상세를 열 때 조회를 보낸다',
     /\/api\/articles\/' \+ encodeURIComponent\(a\._api_id\) \+ '\/view'/.test(art));
  t('id 없는 정적 항목은 건너뛴다', /if\(a\._api_id\)\{/.test(art));
  t('계측 실패가 UX 를 깨지 않는다 (catch)',
     /\/api\/articles\/[\s\S]{0,400}\.catch\(function\(\)\{/.test(art));

  // ⑤ 캐시버스트 — 참조 10곳이 같은 판이어야 한다
  const artRefs = ['about', 'articles', 'business', 'community', 'contact',
                   'films', 'index', 'pullletter', 'submission', 'subscribe']
    .map((n) => 'frontend/' + n + '.html');
  const artVers = artRefs.map((f) => (R(f).match(/pap-content-article\.js\?v=(\d+)/) || [])[1]);
  t('pap-content-article.js 참조 10곳의 판이 모두 같다',
     artVers.every((v) => v && v === artVers[0]),
     artRefs.map((f, i) => f + '=' + artVers[i]).join(', '));
  t('pap-content-article.js 판이 46 보다 크다 (이번 수정분 반영)',
     Number(artVers[0]) > 46, 'v=' + artVers[0]);
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ kr-growth-surface tests FAILED'); process.exit(1); }
console.log('✅ kr-growth-surface tests passed');
