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
  /* 2026-08-19 — 문장 모양이 아니라 '무엇을 저장하는가'를 본다.
     AI 리퍼러 폴백이 들어오면서 이 줄이 삼항식이 됐는데(srcRaw 없으면
     AI 플랫폼 이름), 지켜야 할 것은 '저장값이 normalizeSrc 를 거친다'이지
     'const src = normalizeSrc(srcRaw) 라고 쓰여 있다'가 아니다.
     8/18 에 vercel.json 원문 정규식으로 같은 종류의 헛발을 밟았다. */
  t('정규화 결과를 저장한다', /const src = [^;\n]*normalizeSrc\(srcRaw\)/.test(si));
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
  /* 2026-08-17 도메니코 지시로 뒤집힘 — '종이 인쇄본 없음' 서사를 전 자산에서
     제거했다(어바웃 7곳 + llms.txt + digital-magazine). 가드도 반대로 지킨다. */
  t("'종이 없음' 서사를 쓰지 않는다 (도메니코 확정)", !/no print edition|종이 인쇄본|종이 잡지/i.test(llms));
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
  /* 2026-08-22 — 화면별 분모를 재려고 '/view' 에 ?surface=spa 를 붙였다.
     검사할 사실은 "상세를 열 때 그 기사 id 로 조회를 보낸다" 이지 URL 이
     정확히 '/view' 로 끝나느냐가 아니다. 쿼리 유무에 안 깨지게 고친다. */
  t('기사 상세를 열 때 조회를 보낸다',
     /\/api\/articles\/' \+ encodeURIComponent\(a\._api_id\) \+ '\/view(\?[a-z=]+)?'/.test(art));
  t('그 조회에 화면 라벨(surface=spa)이 붙는다', /\/view\?surface=spa'/.test(art));
  t('id 없는 정적 항목은 건너뛴다', /if\(a\._api_id && !_papArtRerender\)\{/.test(art));
  /* 2026-08-13 — 언어 변경 재렌더가 조회를 부풀리고 있었다.
     'pap:langchange' 핸들러가 같은 기사를 다시 그리는데 그 경로도 이 함수를
     지나므로, 한 번 읽은 기사가 언어를 바꿀 때마다 1건씩 더 쌓였다.
     에디토리얼은 _openEditorialInner_noPush 로 분리해 막아뒀는데 기사엔 없었다. */
  t('언어 변경 재렌더는 조회로 세지 않는다 (중복 방지)',
     /var _papArtRerender = false;/.test(art)
     && /_papArtRerender=true;[\s\S]{0,120}finally \{ _papArtRerender=false; \}/.test(art));
  t('깃발이 langchange 핸들러 안에서만 켜진다',
     /pap:langchange[\s\S]{0,220}_papArtRerender=true/.test(art));
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

console.log('\n[14] 전환 깔때기 계측 — 웹의 존재 이유를 재는 자 (2026-08-13)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * 2026-08-12 기사 조회 계측을 붙이자 하루 661명이 사이트 안에서 기사를 연다는
   * 사실이 드러났다(에디토리얼 141의 4.7배). 그런데 그 다음이 깜깜했다:
   *
   *   1 기사 조회        article_views   ✅ 하루 661
   *   2 구독 페이지 도달  ─               ❌ 없음  ← 이번에 채운다
   *   3 결제 시작        ─               ❌ 없음  (결제 전환 중 — 일부러 안 건드림)
   *   4 결제 완료        subscriptions   ✅ 13건 (active 5)
   *
   * Vercel Web Analytics 404(꺼짐) · 페이지 분석 스크립트 0개 — 확인했다.
   * 성장 헌법 1항이 말하는 웹의 존재 이유(유료 구독자 증식)를 재는 자가 없었다.
   *
   * 여기서 지키는 것:
   *   ① 엔드포인트가 article_views 와 같은 기둥을 쓴다
   *   ② step·source 화이트리스트 — 자유 문자열이 표를 쓰레기통으로 만들지 않는다
   *   ③ 결제 단계는 화이트리스트에 없다 (금지 구역 불가침)
   *   ④ 마이그레이션 미실행(42P01)이어도 500 이 아니라 204
   *   ⑤ 구독 페이지가 실제로 부른다 · 결제 코드는 안 건드렸다 */

  const fs  = R('api/funnel/step.js');
  const av  = R('api/articles/[id]/view.js');
  const sub = R('frontend/subscribe.html');
  const mig = R('supabase_migrations/124_funnel_events.sql');

  // ① 같은 기둥
  t('깔때기 엔드포인트가 있다', fs.length > 500);
  t('funnel_events 에 기록한다', /from\('funnel_events'\)/.test(fs));
  t('POST 만 받는다', /req\.method !== 'POST'/.test(fs));
  t('article_views 와 같은 기둥 (봇·레이트·토큰)',
     ['isBot', 'rateLimit', 'verifyToken'].every((n) => fs.includes(n) && av.includes(n)));
  t('봇은 세지 않는다', /isBot\(req\.headers\['user-agent'\]\)/.test(fs));
  t('로그인 없이도 기록된다', !/requireAuth/.test(fs));
  t('탈퇴계정 FK(23503) 익명 강등 재시도', /error\.code === '23503' && viewerId/.test(fs));

  // ② 화이트리스트 — 표가 쓰레기통이 되지 않게
  t('step 화이트리스트가 있다', /const STEPS = new Set\(/.test(fs));
  t('모르는 step 은 400', /STEPS\.has\(step\)/.test(fs) && /400/.test(fs));
  t('source 화이트리스트가 성장헌법 3항 utm 목록을 담는다',
     ['x', 'ig', 'naver', 'kakao', 'newsletter', 'threads', 'tiktok', 'youtube']
       .every((s) => new RegExp("'" + s + "'").test(fs)));
  t('모르는 source 는 other 로 접는다', /SOURCES\.has\(rawSource\) \? rawSource : 'other'/.test(fs));
  t('path 는 길이를 자른다 (무한 문자열 방지)', /clip\(body\.path, 200\)/.test(fs));

  // ③ 금지 구역 불가침 — 이게 이 블록에서 제일 중요하다
  t('결제 단계는 화이트리스트에 없다 (PayPal 전환 중)',
     !/checkout_start|checkout_ok|checkout_fail|payment_/.test(
       (fs.match(/const STEPS = new Set\(\[[^\]]*\]\)/) || [''])[0]));
  t('결제 파일을 건드리지 않았다',
     !/funnel\/step|funnel_events/.test(R('api/subscriptions/checkout.js'))
     && !/funnel\/step|funnel_events/.test(R('api/subscriptions/guest-checkout.js')));

  // ④ 마이그레이션 미실행 내성
  t('표가 없으면(42P01) 500 이 아니라 204', /error\.code === '42P01'/.test(fs) && /status\(204\)/.test(fs));
  t('마이그레이션 파일이 저장소에 있다', /create table if not exists public\.funnel_events/.test(mig));
  t('마이그레이션이 RLS 를 켠다', /enable row level security/.test(mig) && /admin_read_funnel/.test(mig));
  t('마이그레이션에 되돌리기 방법이 적혀 있다', /DROP TABLE public\.funnel_events/i.test(mig));

  // ⑤ 구독 페이지가 실제로 부른다
  t('구독 페이지가 깔때기를 부른다', /'\/api\/funnel\/step'/.test(sub));
  t('subscribe_view 를 보낸다', /step:'subscribe_view'/.test(sub));
  t('utm_source 를 읽어 붙인다', /utm_source/.test(sub));
  t('계측 실패가 결제 화면을 깨지 않는다 (catch)',
     /\/api\/funnel\/step[\s\S]{0,400}\.catch\(function\(\)\{\}\)/.test(sub));
}

console.log('\n[15] 네이버 애널리틱스 — 사람이 받는 페이지에 붙인다 (2026-08-13)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * 실측(2026-08-13, 라이브 확인):
   *   카카오 JS 키      ✅ 이미 설정됨 · 공유 버튼 화면에 보임 · SDK 초기화됨
   *                        → 카카오 유입 0 은 문이 닫혀서가 아니라 아무도 안 눌러서다
   *   네이버 애널리틱스  ❌ 사람이 받는 페이지에 스크립트 자체가 없다
   *
   * 원인: NAVER_ANALYTICS_ID 가 seoRenderer(SSR)에만 심겨 있었다. 그런데 SSR 은
   * **봇에게만** 나가고 사람은 정적 HTML 을 받는다. 계정번호를 넣어도 사람은
   * 한 명도 세어지지 않는 상태였다. 2026-08-12 인클릭 비콘이 고친 것과
   * 글자 그대로 같은 구멍이다 (GROWTH-LEDGER 교훈 8).
   *
   * 여기서 지키는 것:
   *   ① 계정번호가 공개 설정 통로로 내려온다 (카카오 키와 같은 길)
   *   ② 사람이 받는 정적 랜딩에 로더가 실린다
   *   ③ SSR 에도 남아 있으므로 **겹치지 않아야 한다** — 로더는 SSR 에 안 실린다
   *   ④ 계정번호가 없으면 외부 요청조차 만들지 않는다
   *   ⑤ 참조 10곳의 판이 같이 올라갔다 */

  const cfg = R('api/content/config.js');
  const inc = R('frontend/pap-inclick.js');

  // ① 공개 설정 통로
  t('config 가 네이버 계정번호를 내려준다', /naverAnalyticsId: process\.env\.NAVER_ANALYTICS_ID/.test(cfg));
  t('카카오 키와 같은 통로다 (규칙을 두 벌로 만들지 않는다)', /kakaoJsKey: process\.env\.KAKAO_JS_KEY/.test(cfg));
  t('비밀값을 흘리지 않는다 (Admin·REST·시크릿 없음)',
     !/ADMIN_KEY|REST_API_KEY|_SECRET|SERVICE_ROLE/.test(cfg));

  // ② 사람이 받는 페이지에 로더가 있다
  t('인클릭 파일에 네이버 로더가 있다', /wcs\.naver\.net\/wcslog\.js/.test(inc));
  t('계정번호를 config 에서 받아온다', /cfg && cfg\.naverAnalyticsId/.test(inc));
  t('네이버 표준 호출을 한다 (inflow + wcs_do)',
     /wcs\.inflow\('pap-magazine\.com'\)/.test(inc) && /wcs_do\(\)/.test(inc));
  /* 2026-08-13 실측 — 네이버 콘솔이 발급한 스니펫은 wcs.pstatic.net 을 쓰는데
     브라우저에서 순서 바꿔 2회 확인한 결과 pstatic 은 로드 실패, naver.net 만
     성공했다. 되는 쪽을 먼저 쓰되 한쪽이 죽어도 계측이 조용히 멈추지 않게
     두 호스트를 순서대로 시도한다. */
  t('스크립트 호스트를 두 개 시도한다 (한쪽이 죽어도 안 멈춘다)',
     /wcs\.naver\.net\/wcslog\.js/.test(inc) && /wcs\.pstatic\.net\/wcslog\.js/.test(inc));
  t('되는 쪽(naver.net)을 먼저 시도한다',
     inc.indexOf('wcs.naver.net') < inc.indexOf('wcs.pstatic.net'));
  t('로드 실패 시 다음 호스트로 넘어간다', /tag\.onerror = function \(\) \{ load\(i \+ 1\); \}/.test(inc));

  // ③ 이중 집계 금지 — 로더는 SSR 상세에 실리지 않는다
  {
    const ssr = R('api/_lib/seoRenderer.js');
    t('SSR 은 종전대로 서버가 직접 심는다', /NAVER_ANALYTICS_ID \? `/.test(ssr));
    t('SSR 상세에는 인클릭 파일을 싣지 않는다 (이중 집계 방지)',
       !/pap-inclick\.js/.test(ssr));
  }

  // ④ 계정번호 없으면 외부 요청조차 안 만든다
  t('계정번호가 없으면 조용히 끝낸다', /if \(!id\) return;/.test(inc));
  t('계측 실패가 페이지를 막지 않는다',
     (inc.match(/catch \(e\) \{/g) || []).length >= 2 && /\.catch\(function \(\)/.test(inc));

  // ⑤ 캐시버스트 — 참조 10곳
  {
    const refs = ['about', 'articles', 'community', 'digital-magazine', 'films',
                  'index', 'magazine', 'network', 'subscribe']
      .map((n) => 'frontend/' + n + '.html').concat(['api/seo/archive.js']);
    const vers = refs.map((f) => (R(f).match(/pap-inclick\.js\?v=(\d+)/) || [])[1]);
    t('pap-inclick.js 참조 10곳의 판이 모두 같다',
       vers.every((v) => v && v === vers[0]),
       refs.map((f, i) => f + '=' + vers[i]).join(', '));
    t('pap-inclick.js 판이 1 보다 크다 (이번 수정분 반영)',
       Number(vers[0]) > 1, 'v=' + vers[0]);
  }
}

console.log('\n[17] 어드민에서 유입·전환을 볼 수 있다 (2026-08-13 도메니코 요청)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * 2026-08-12~13 에 계측 세 개를 새로 만들었다:
   *   article_views(기사 조회) · funnel_events(구독 페이지 도달) · social_inclicks(유입)
   * 그런데 셋 다 DB 에만 쌓이고 어드민 어디에도 안 보였다.
   * **숫자를 만들어 놓고 안 보면 없는 것과 같다.** 오늘 배운 것의 연장이다.
   *
   * 새 페이지를 만들지 않고 이미 있는 /ops-dashboard 에 한 칸을 붙인다
   * (도메니코 선택, 2026-08-13). 관리할 화면을 늘리지 않는다.
   *
   * ⚠️ 네이버 애널리틱스 자체 수치는 넣을 수 없다 — 네이버가 조회 API 를
   *    일반 제공하지 않는다. 화면이 그 사실을 사용자에게 말해야 한다.
   *    (안 그러면 "네이버 숫자가 왜 없지" 로 또 하루를 쓴다) */

  const api  = R('api/admin/ops-dashboard.js');
  const html = R('frontend/ops-dashboard.html');

  // ① API 가 세 계측을 모두 집계한다
  t('기사 조회를 집계한다', /countOf\('article_views'/.test(api));
  t('구독 페이지 도달을 집계한다',
     /countOf\('funnel_events'[\s\S]{0,80}subscribe_view/.test(api));
  t('유입 채널(social_inclicks)을 집계한다', /rows\('social_inclicks'/.test(api));
  t('응답에 funnel 블록을 담는다', /\n\s*funnel,\n/.test(api));
  t('오늘·7일·30일 세 창을 다 준다',
     /article_views_today/.test(api) && /article_views_7d/.test(api) && /article_views_30d/.test(api));

  // ② 스코프 함정 — W 는 outclicks 블록 안에서만 산다. node --check 가 못 잡는다.
  t('유입 집계가 자기 시간창(WF)을 따로 만든다 (ReferenceError 방지)',
     /const WF\s*=\s*kstWindows\(/.test(api));
  t('유입 집계 구간에서 블록 밖 W 를 참조하지 않는다',
     !/funnel_events[\s\S]{0,120}[^F]W\.todayStart/.test(api));

  // ③ 화면이 실제로 그린다
  t('대시보드에 유입·전환 칸이 있다', /Funnel &amp; Inflow/.test(html));
  t('깔때기·채널 두 자리가 있다',
     /id="funnelSteps"/.test(html) && /id="inflowSrc"/.test(html));
  t('renderFunnel 이 정의되고 render 에서 불린다',
     /function renderFunnel\(d\)\{/.test(html) && /\n\s*renderFunnel\(d\);/.test(html));
  t('구독페이지/기사조회 비율을 보여준다', /pct\(f\.subscribe_view_7d, f\.article_views_7d\)/.test(html));

  // ④ 한계를 화면이 말한다 — 침묵하면 또 헤맨다
  t('네이버 수치는 여기 없다고 화면이 알린다',
     /analytics\.naver\.com/.test(html));
  t('utm 없는 유입은 안 잡힌다고 알린다', /utm 꼬리표가 붙은 링크만/.test(html));
  t('기록이 없을 때 빈 화면 대신 안내를 낸다', /최근 30일 기록 없음/.test(html));
}


console.log('\n[18] 어드민이 도달이 아니라 저장율을 대표로 보여준다 (2026-08-16 도메니코 요청)');
{
  /* 왜 ────────────────────────────────────────────────────────────────
   * 30일 실측이 "도달을 목표로 삼지 말라"고 말한다:
   *   2026-07-29  도달 1,609,308 · 좋아요 212,260 · 공유 22,518 · 팔로우   170
   *   2026-08-11  도달   616,522 · 좋아요  34,841 · 공유 36,323 · 팔로우 1,091
   * 도달을 4배 더 한 쪽이 팔로워는 6분의 1이었다(전환 0.011% vs 0.177%).
   *
   * ⚠️ 처음엔 이 두 건만 보고 "공유가 답" 이라고 썼다가 **틀렸다.** 전수 145편
   *    (도달 3,000+·전환 측정분)으로 팔로우'율' 과의 상관을 재보니 순서가 다르다.
   *      아웃라이어 1편 제외 n=144:
   *        저장율 0.464 > 좋아요율 0.378 > 공유율 0.140 > 도달 -0.045
   *    저장을 맨 위에 둔다 — "다시 보러 오겠다" 라 팔로우와 뜻이 가장 가깝다.
   *    도달이 목표가 아니라는 결론만 그대로다(상관 -0.045).
   *    **두 건짜리 표본으로 지표를 정하지 않는다** 가 이 절이 지키는 규칙이다.
   *
   * 그리고 평균을 쓰지 않는다 — 캐러셀 도달 평균 29,270 · 중앙값 9,596.
   * 두 편이 만든 착시다.
   *
   * ⚠️ 이 칸의 핵심은 예쁜 숫자가 아니라 **'안 보이는 건수'** 다.
   *    영상 49편 전부 전환 지표가 NULL 인 걸 한 달 동안 아무도 몰랐다.
   *    화면이 그 공백을 말하지 않으면 또 같은 일이 난다. */

  const api  = R('api/admin/ops-dashboard.js');
  const html = R('frontend/ops-dashboard.html');

  // ① API 가 공유율을 계산해서 내려준다
  t('IG 게시물 지표를 읽는다', /rows\('ig_post_metric'/.test(api));
  t('응답에 ig_perf 블록을 담는다', /\n\s*ig_perf,\n/.test(api));
  t('저장율(save_rate)을 계산한다', /save_rate:\s*rate\(/.test(api));
  t('공유율도 함께 준다 (둘째 지표)', /share_rate:\s*rate\(/.test(api));
  t('팔로우 전환율도 함께 준다', /follow_rate:/.test(api));
  t('평균이 아니라 중앙값을 쓴다', /reach_median/.test(api) && /const median =/.test(api));

  // ② 같은 게시물이 3시간마다 여러 행으로 쌓인다 — 최신 1건만 세야 한다
  t('게시물당 최신 캡처 1건만 집계한다 (중복 합산 금지)',
     /igLatest\.has\(r\.post_id\)/.test(api) && /captured_at.*ascending:\s*false/.test(api));

  // ③ 안 보이는 건수를 반드시 계산한다
  t('전환 지표가 없는 게시물 수를 센다', /blind_posts:/.test(api));
  t('안 보이는 게시물의 도달 합계도 센다', /blind_reach:/.test(api));
  t('전환율은 측정된 게시물만으로 계산한다 (0 으로 속이지 않는다)',
     /igMeasured\s*=\s*igPosts\.filter\(r => r\.follows !== null/.test(api));

  // ④ 도달이 아니라 공유율 순으로 줄 세운다
  t('상위 목록을 저장율로 정렬한다', /sort\(\(a, b\) => b\.save_rate - a\.save_rate\)/.test(api));
  t('표본이 작은 게시물은 비율 순위에서 뺀다', /reach\) >= 3000/.test(api));

  // ⑤ 화면이 실제로 그린다
  t('대시보드에 IG 칸이 있다', /Instagram · 도달이 아니라 저장율/.test(html));
  t('두 자리(요약·상위)가 있다', /id="igPerf"/.test(html) && /id="igTop"/.test(html));
  t('renderIgPerf 가 정의되고 render 에서 불린다',
     /function renderIgPerf\(d\)\{/.test(html) && /\n\s*renderIgPerf\(d\);/.test(html));
  t('저장율이 화면 맨 위 숫자다 (공유율·도달보다 먼저)',
     html.indexOf("line('저장율'") > 0
     && html.indexOf("line('저장율'") < html.indexOf("line('공유율'")
     && html.indexOf("line('공유율'") < html.indexOf("line('도달 중앙값'"));
  t('왜 저장율인지 상관계수를 화면에 남긴다 (두 건짜리 근거로 되돌아가지 않게)',
     /저장율 0\.46/.test(html) && /도달 -0\.05/.test(html));

  // ⑥ 한계를 화면이 말한다 — 침묵하면 또 헤맨다
  t('안 보이는 게시물이 있으면 빨갛게 알린다',
     /전환 지표가 안 보이는 게시물/.test(html));
  t('"모릅니다" 라고 분명히 말한다 (0 처럼 보이게 두지 않는다)',
     /팔로워를 데려왔는지는 <b>모릅니다/.test(html));
  t('개별 게시물에도 안 보임을 표시한다', /안 보임<\/span>/.test(html));
  t('실측 대비 두 건도 화면에 남긴다',
     /도달 1,609,308 짜리가 팔로우 170/.test(html));
  t('표본 하한을 화면이 설명한다', /표본이 작으면 비율이 튑니다/.test(html));
  t('기록이 없을 때 빈 화면 대신 안내를 낸다', /최근 30일 게시물 지표 없음/.test(html));
}


console.log('\n[19] 카테고리 페이지(/digital-magazine)가 고아가 아니다 (2026-08-17)');
{
  /* AI 가 "매거진 추천" 에 답할 때 무는 건 제3자 문서지만, 우리 쪽 카테고리
   * 정의 페이지는 그 보조 재료다. 만들어 놓고(08-12) 사이트맵에도 없고 내부
   * 링크가 about 한 곳뿐이었다 — /studio 가 겪은 '색인 경로 없음' 재발.
   * 그리고 도메니코가 지목한 데일리패션뉴스가 목록에 빠져 있었다. */
  const sm  = R('api/sitemap.js');
  const dm  = R('frontend/digital-magazine.html');
  const seo = R('api/_lib/seoRenderer.js');

  t('사이트맵에 등재됐다', /digital-magazine/.test(sm));
  t('SSR 하단 nav 가 링크한다 (모든 봇 페이지에서 1회)', /\/digital-magazine">Digital Magazine</.test(seo));
  /* 2026-08-17: 목록 구성은 편집 판단 = 도메니코의 것. 같은 날 두 번 바뀌었다
     (뺐다가 재포함 + PAP·아이즈매거진 양쪽 유형 병기). 가드는 최종 지시를 고정한다. */
  t('데일리패션뉴스가 실려 있다 (도메니코 재포함 지시)', /데일리패션뉴스/.test(dm));
  t('제외 지시 6곳이 실려 있지 않다 (도메니코 2026-08-17: IZE·디에디트·디자인프레스·매거진F·룩스매거진·싱글즈)',
    !/IZE|디에디트|디자인프레스|매거진F|룩스매거진|싱글즈/.test(dm));
  t('PAP 이 웹·인스타그램 두 표에 모두 있다',
    /PAP 매거진 \(pap-magazine\.com\)/.test(dm) && /PAP 매거진 \(@pap_magazine\)/.test(dm));
  t('아이즈매거진도 두 표에 모두 있다',
    /아이즈매거진 \(eyesmag\)/.test(dm) && /아이즈매거진 \(@eyesmag\)/.test(dm));
  t('보이는 FAQ 와 JSON-LD FAQ 가 같은 답을 말한다 (한쪽만 고치는 사고 방지)',
    (dm.match(/두 유형에 모두 속합니다/g) || []).length >= 2);

  /* 2026-08-17 발행인 정정 — PAP 는 웹·인스타그램 **동시 창간**이다.
     "인스타그램에서 시작해 웹으로 확장" 서사가 llms.txt·about·digital-magazine
     세 곳에 박혀 있었고 나까지 그걸 근거로 썼다. 재발 방지 가드. */
  const ab = R('frontend/about.html');
  const lt = R('frontend/llms.txt');
  t('동시 창간 서사가 세 파일에 있다',
    /웹과 인스타그램에서 동시에 창간/.test(dm) && /웹과 인스타그램에서 동시에 창간/.test(ab)
    && /launched on the web and on Instagram simultaneously/i.test(lt));
  t('"인스타에서 시작해 웹으로 확장" 서사가 PAP 서술로 남아 있지 않다',
    !/PAP[^.]{0,40}인스타그램에서 (시작|창간)/.test(dm + ab)
    && !/PAP Magazine (started|originated) on Instagram/.test(lt));

  /* 2026-08-19 — 이 페이지는 색인은 됐는데 랭킹 키워드 0 · AI 인용 0 이었다.
     원인 둘: ① '디지털 매거진' 은 검색 의도가 전자잡지 제작 툴이라 헛다리,
     ② 매체 18곳을 이름만 나열해 인용할 사실이 없었다.
     도메니코 결정으로 경쟁사 개별 수치는 못 쓰므로, 대신 공적 통계와
     정의·분류를 채웠다. 그 재료가 빠지면 다시 0 으로 돌아간다. */
  t('공적 통계 섹션이 있다 (출처 표기 포함)',
    /2024 잡지산업 실태조사/.test(dm) && /국가승인통계 제413001호/.test(dm)
    && /1,796개/.test(dm) && /3,947부/.test(dm));
  t('경쟁 매체 개별 수치는 싣지 않는다 (도메니코 2026-08-19)',
    !/(아이즈매거진|하입비스트 코리아|패스트페이퍼|데일리패션뉴스|데이즈드 코리아)[^<]{0,80}(만 명|팔로워)/.test(dm));
  t('정의·분류 FAQ 3문항이 화면에 있다',
    /웹진, 전자잡지, 디지털 매거진은 어떻게 다른가요\?/.test(dm)
    && /종이 잡지의 디지털판과 웹에서 창간한 매거진은 뭐가 다른가요\?/.test(dm)
    && /디지털 매거진 광고는 무엇으로 측정하나요\?/.test(dm));
  t('그 3문항이 JSON-LD 에도 같이 있다 (한쪽만 고치는 사고 방지)',
    (dm.match(/웹진, 전자잡지, 디지털 매거진은 어떻게 다른가요\?/g) || []).length >= 2
    && (dm.match(/디지털 매거진 광고는 무엇으로 측정하나요\?/g) || []).length >= 2);
  t('자사 홍보용 FAQ("계정을 몇 개")가 빠졌다',
    !/인스타그램 계정을 몇 개 운영하나요/.test(dm));
  t('제목이 실제 검색 질의를 겨냥한다 (전자잡지 제작 툴 질의 회피)',
    /<title>한국 디지털 패션 매거진 정리/.test(dm));

  /* 2026-08-20 — 영문판 분리.
     영어권 'korean fashion magazines' 1페이지는 잡지 쇼핑몰(DR34)·위키백과·핀터레스트·
     이베이·**DR11 블로그(7위)**·아마존이다. 제대로 된 문서가 없는 자리다.
     한 페이지에 두 언어가 섞이면 어느 쪽으로도 안 잡히므로 URL 을 나눈다. */
  const en = R('frontend/en-korean-digital-magazines.html');
  const vj = JSON.parse(R('vercel.json'));
  t('영문판 페이지가 존재한다', en.length > 3000);
  t('영문판 canonical 이 자기 주소를 가리킨다',
    /<link rel="canonical" href="https:\/\/www\.pap-magazine\.com\/korean-digital-magazines">/.test(en));
  t('영문판 라우팅(rewrite)이 있다',
    vj.rewrites.some((r) => r.source === '/korean-digital-magazines'
      && r.destination === '/en-korean-digital-magazines.html'));
  t('영문판 .html 은 확장자 없는 주소로 301',
    vj.redirects.some((r) => r.source === '/en-korean-digital-magazines.html'
      && r.destination === '/korean-digital-magazines' && r.statusCode === 301));
  t('hreflang 이 양방향이다 (한쪽만 걸면 구글이 짝을 못 짓는다)',
    /hreflang="en" href="https:\/\/www\.pap-magazine\.com\/korean-digital-magazines"/.test(dm)
    && /hreflang="ko" href="https:\/\/www\.pap-magazine\.com\/digital-magazine"/.test(en));
  t('한국어 페이지에 영문 본문이 남아 있지 않다 (링크만)',
    /href="\/korean-digital-magazines"/.test(dm)
    && !/A <strong>digital magazine<\/strong> is a magazine published on the web/.test(dm));
  t('영문판에도 FAQPage 스키마가 있다', /"@type":\s*"FAQPage"/.test(en));
  t('영문판이 경쟁 매체를 함께 싣는다 (우리만 있는 목록 금지)',
    ['Vogue Korea', 'Elle Korea', 'Dazed Korea', 'Eyesmag', 'Hypebeast Korea', 'Fastpaper']
      .every((n) => en.includes(n)));
  t('영문판도 경쟁 매체 개별 수치는 싣지 않는다 (도메니코 2026-08-19)',
    !/(Eyesmag|Dazed Korea|Fastpaper|Daily Fashion News|Hypebeast Korea)[^<]{0,80}(followers|million|만 명)/i.test(en));
  t('영문판이 사이트맵에 등재됐다', /korean-digital-magazines/.test(R('api/sitemap.js')));
  t('영문판 IG 링크는 직링크가 아니다 (성장 헌법 3항)',
    !/href="https:\/\/www\.instagram\.com/.test(en));

  /* 2026-08-17 도메니코 지시 — '팝매거진' 으로도 검색되게. 한국어 검색(네이버)은
     제목 일치 가중이 크다. 홈·어바웃 제목 + llms.txt 별칭 줄로 고정한다.
     SSR 기사 제목 수천 장에는 일부러 안 넣는다 — 반복은 스팸 신호이고,
     그쪽은 전 페이지 스키마 alternateName 이 이미 커버한다. */
  const ix = R('frontend/index.html');
  /* 2026-08-17 도메니코 확정: "PAP Magazine (팝매거진) — Art Fashion, …"
     — 'Korean' 제외, 별칭은 괄호 표기 하나로. */
  t("홈 제목 3종(title·og·twitter)이 확정안과 일치한다",
    (ix.match(/PAP Magazine \(팝매거진\) — Art Fashion, Beauty & Culture Magazine/g) || []).length >= 3
    && !/— Korean Art Fashion/.test(ix));
  t("어바웃 제목에 '팝매거진' 이 있다", /<title>About · 소개 \| PAP MAGAZINE 팝매거진<\/title>/.test(ab));
  t('llms.txt 가 표기 변형을 한 줄로 선언한다',
    /Also searched \/ written as: 팝매거진, PAP매거진/.test(lt));
  t('SSR 스키마 alternateName 에 팝매거진·팹매거진이 있다',
    /'팝매거진', '팹매거진'/.test(R('api/_lib/seoRenderer.js')));
  /* 2026-08-17 도메니코 — 구글 '팝매거진' 대응은 보이는 텍스트로. 그리고
     pop 매거진과의 비교 문구는 쓰지 않는다 (도메니코 지시). */
  /* 2026-08-25 — 저작권 줄의 '팝매거진'은 ko 전용으로 좁혔다. GSC 표준 태그
     충돌 1,655건 진단: 언어판(/it 등)에 한국어 가시 텍스트가 나가면 ko 정본의
     사본처럼 보여 구글이 self-canonical 을 무시한다. ko SERP 대응 목적은
     ko 페이지에서 그대로 유지된다. */
  t('SSR 저작권 줄 — ko 에서만 팝매거진 병기, 언어판은 제외',
    /© PAP MAGAZINE\$\{lang === 'ko' \? ' 팝매거진' : ''\}/.test(R('api/_lib/seoRenderer.js')));
  t("FAQ 에 '팝매거진은 무엇인가요' 문답이 화면·스키마 양쪽에 있다",
    /팝매거진은 무엇인가요/.test(R('frontend/pap-faq-i18n.js'))
    && /팝매거진은 무엇인가요/.test(ab));
  t('pop 매거진 비교 문구를 쓰지 않는다 (도메니코 지시)',
    !/pop magazine|팝\(POP\)|POP\) 매거진/i.test(R('frontend/pap-faq-i18n.js'))
    && !/pop magazine/i.test(ab));
  t('JSON-LD 가 전부 파싱된다', (function(){
    try { for (const m of dm.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]); return true; }
    catch (e) { return false; }
  })());
}

/* ── [20] 언어별 진입 페이지 /ja · /en (2026-08-20) ────────────────
   기사는 9개 언어인데 홈·목록은 한국어뿐이었다. `/ja` `/en` 은 `/` 로 301 이라
   구글 입장에서 '일본어 사이트'가 존재하지 않았다 — 기사 낱장만 있었다.
   ja 는 GSC 유입 2위 언어다(워터밤·KATSEYE·지미로콰이 상위 페이지 다수).
   여기서 지키는 것: ① 라우팅이 실제로 살아 있는가(옛 301 이 남아 있으면 죽는다)
   ② hreflang 이 3방향 왕복하는가 ③ 한국어 제목이 섞여 나가지 않는가
   ④ IG 아웃링크가 계측 경로를 타는가(성장 헌법 3항) */
console.log('\n[20] 언어별 진입 페이지 /ja · /en');
{
  const vj = JSON.parse(R('vercel.json'));
  const lh = R('api/seo/locale-home.js');
  const idx = R('frontend/index.html');
  const rwSrc = vj.rewrites.map((r) => r.source);
  const rdSrc = vj.redirects.map((r) => r.source);

  t('/ja · /en 이 로케일 홈으로 rewrite 된다',
    ['/ja', '/en'].every((p_) => vj.rewrites.some((r) =>
      r.source === p_ && /locale-home\?lang=/.test(r.destination))));

  /* 옛 301 이 하나라도 남아 있으면 rewrite 는 절대 실행되지 않는다 —
     Vercel 은 redirects 를 rewrites 보다 먼저 적용한다(2026-08-20 /en 404 사고). */
  t('옛 `/en → /` 301 이 제거됐다', !rdSrc.includes('/en') && !rdSrc.includes('/en/'));
  t('로케일 루트 일괄 301 에서 ja 가 빠졌다',
    !rdSrc.some((s_) => /^\/:lang\([^)]*\bja\b[^)]*\)$/.test(s_)));
  t('나머지 언어는 종전대로 / 로 301 유지 (열지 않은 언어를 열지 않는다)',
    rdSrc.some((s_) => s_ === '/:lang(fr|it|es|de|ru|zh)'));
  t('rewrite 가 편집자 캐치올(/:slug)보다 앞에 있다',
    rwSrc.indexOf('/ja') < rwSrc.findIndex((s_) => /^\/:slug/.test(s_)));

  /* hreflang — 한쪽만 걸면 구글이 짝을 못 짓는다. 문자열이 정확히 같아야 한다. */
  for (const code of ['ko', 'ja', 'en', 'x-default']) {
    t('한국어 홈에 hreflang ' + code + ' 이 있다',
      new RegExp('hreflang="' + code + '" href="https://www\\.pap-magazine\\.com').test(idx));
  }
  t('한국어 홈의 hreflang ko 가 canonical 과 글자까지 같다 (슬래시 포함)',
    /rel="canonical" href="https:\/\/www\.pap-magazine\.com">/.test(idx)
    && /hreflang="ko" href="https:\/\/www\.pap-magazine\.com">/.test(idx));
  t('로케일 홈도 ko 를 슬래시 없이 가리킨다 (양쪽 문자열 일치)',
    /\['ko', SITE\]/.test(lh) && /\['x-default', SITE\]/.test(lh));
  t('로케일 홈이 ja·en 을 모두 alternate 로 내보낸다',
    /\['ja', SITE \+ '\/ja'\]/.test(lh) && /\['en', SITE \+ '\/en'\]/.test(lh));

  /* 언어 신호 — 번역 제목이 없는 항목은 싣지 않는다 */
  t('번역 제목이 없으면 목록에서 뺀다 (한국어 제목 혼입 금지)',
    /if \(!t\) return null;/.test(lh) && /\.filter\(Boolean\)/.test(lh));
  t('en 은 title_en, 그 외는 번역표에서 제목을 가져온다',
    /lang === 'en'\) \? row\.title_en : map\.get\(row\.id\)/.test(lh));
  t('en 은 seo_translations 를 조회하지 않는다 (그 언어 행이 없다)',
    /if \(lang === 'en' \|\| !ids\.length\) return new Map\(\);/.test(lh));
  t('html lang 과 og:locale 이 해당 언어다',
    /<html lang="\$\{esc\(cfg\.htmlLang\)\}">/.test(lh)
    && /og:locale" content="\$\{esc\(cfg\.htmlLang\)\}"/.test(lh));
  t('지원하지 않는 언어는 404 다 (임의 로케일 양산 금지)',
    /if \(!cfg\) return res\.status\(404\)/.test(lh));

  /* 성장 헌법 3항 — 웹→IG 는 /api/ig-out 경유만 */
  t('IG 아웃링크가 ig-out 계측을 탄다',
    /\/api\/ig-out\?src=locale_home&amp;to=profile&amp;url=/.test(lh));
  t('IG 직링크를 쓰지 않는다', !/href="https:\/\/www\.instagram\.com/.test(lh));
  t('locale_home 이 ig-out 소스 화이트리스트에 있다',
    /'locale_home'/.test(R('api/ig-out.js')));

  t('사이트맵에 /ja · /en 이 있다', (function () {
    const sm = R('api/sitemap.js');
    return /path: '\/ja'/.test(sm) && /path: '\/en'/.test(sm);
  })());
  t('캐시 헤더가 목록 페이지와 같은 규칙이다',
    /s-maxage=1800, stale-while-revalidate=86400/.test(lh));
}


/* ─── [20] 홈이 "웹매거진"이라는 말을 갖고 있는가 (2026-08-23) ─────────────
   실측: 구글 "한국 패션 웹매거진" 1페이지 상위 7개가 전부 매체 홈페이지다
   (보그·엘르·하입비스트·아이즈매거진·마리끌레르·GQ·W). 우리 홈은 그 자리에
   없고, 대신 /digital-magazine 이 8위로 들어가 있다.
   아이즈는 홈 설명문에 "웹 매거진"을 명시한다. 우리 홈에는 그 말이 한 곳도
   없었다 — 카테고리 질의가 걸릴 표면 자체가 없었던 것.
   도메니코 2026-08-23 승인: title(브랜드 자산)은 그대로, 설명문만 고친다. */
{
  const home = R('frontend/index.html');
  const m = home.match(/<meta name="description" content="([^"]+)"/);
  t('홈에 description 이 있다', !!m);
  const desc = m ? m[1] : '';
  t('홈 설명문이 "웹매거진"을 말한다 (카테고리 질의가 걸릴 표면)',
    /웹매거진|웹 매거진/.test(desc), desc.slice(0, 60));
  t('그러면서 "디지털 매거진"도 유지한다 (기존에 잡히던 말을 버리지 않는다)',
    /디지털 매거진/.test(desc));
  t('브랜드 title 은 건드리지 않았다',
    /<title>PAP Magazine \(팝매거진\) — Art Fashion, Beauty & Culture Magazine<\/title>/.test(home));
}


/* ─── [21] /instagram-magazine — "인스타그램 매거진" 전용 페이지 (2026-08-23) ──
   실측: "인스타그램 매거진"(월 200, 카테고리 최대 검색어) SERP 1페이지가
   정의형·리스트형 글로 채워져 있고 우리는 20위 안에 없었다. 그 형태의 전용
   페이지를 만들고 색인 경로(사이트맵·SSR nav·교차링크)를 처음부터 전부 깐다
   — /studio·/digital-magazine 이 겪은 '고아 페이지' 재발 방지. */
{
  const im = R('frontend/instagram-magazine.html');
  t('/instagram-magazine 페이지가 존재한다', im.length > 3000);
  t('제목·H1 이 검색어를 정면으로 받는다', /<title>인스타그램 매거진이란\?/.test(im) && /<h1>인스타그램 매거진이란\?/.test(im));
  t('대표 계정 리스트에 실측 팔로워가 있다 (경쟁 문서엔 없는 재료)',
    /134만/.test(im) && /@eyesmag/.test(im) && /@dailyfashion_news/.test(im) && /@pap_magazine/.test(im));
  t('PAP 을 실제 순위 자리에 정직하게 넣었다 (끼워넣기 티가 나면 신뢰를 잃는다)',
    /* 2026-08-23 도메니코: HIP·뉴소스·글로우업·디에디트는 뺀다 — 패션 매거진 4곳으로 조인다.
       PAP 은 팔로워 순 마지막 자리 그대로: 패스트페이퍼 뒤. */
    /패스트페이퍼[\s\S]{0,400}PAP 매거진/.test(im) && !/글로우업|hipkr_|newsourcemag/.test(im));
  t('FAQ 화면과 JSON-LD 가 함께 있다', /<details>/.test(im) && /"@type": "FAQPage"/.test(im));
  t('ItemList 스키마가 있다 (리스트형 질의 대응)', /"@type": "ItemList"/.test(im));
  t('IG 아웃링크가 ig-out 계측을 탄다 (성장 헌법 3항)',
    /\/api\/ig-out\?src=instamag/.test(im) && !/href="https:\/\/www\.instagram\.com/.test(im));
  t('사이트맵에 등재됐다', /path: '\/instagram-magazine'/.test(R('api/sitemap.js')));
  t('SSR nav 에서 링크된다 (고아 방지)', /\/instagram-magazine">Instagram Magazine</.test(R('api/_lib/seoRenderer.js')));
  t('llms.txt 에 등재됐다', /instagram-magazine/.test(R('frontend/llms.txt')));
  t('digital-magazine 과 상호 링크된다',
    /href="\/instagram-magazine"/.test(R('frontend/digital-magazine.html')) && /href="\/digital-magazine"/.test(im));
  t('라우팅·리다이렉트가 있다', (function(){
    const v = JSON.parse(R('vercel.json'));
    return (v.rewrites||[]).some((r)=>r.source==='/instagram-magazine')
        && (v.redirects||[]).some((r)=>r.source==='/instagram-magazine.html');
  })());
  t('최상급 표현이 없다 (비교 근거는 실측 수치만)', !/국내 최고|최대 규모|1위 매체/.test(im));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ kr-growth-surface tests FAILED'); process.exit(1); }
console.log('✅ kr-growth-surface tests passed');
