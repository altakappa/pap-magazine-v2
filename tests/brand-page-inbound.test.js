/**
 * 브랜드 허브 페이지 회귀 (2026-07-29, 도메니코 "2번 화보목록 이어서 · 3번 회복").
 *
 * 이 페이지의 목적은 SEO 장식이 아니라 **인바운드 유입**이다. 브랜드 담당자가
 * "브랜드명 + 화보" 로 검색해 들어와 → PAP가 우리를 다뤘구나 → 문의로 넘어가는
 * 경로. 그런데 실측해보니 두 군데가 끊겨 있었다.
 *
 *  ② 화보 목록이 2026-05-04 에 멈춰 있었다.
 *     editorial_brands 매핑 테이블의 마지막 적재일이 2026-05-04 다. 즉 5월 이후
 *     발행분은 브랜드 페이지에 영영 안 뜬다 — 담당자 눈에는 "석 달 전이 마지막"
 *     으로 보인다. 인바운드를 노리는 페이지에서 이건 치명적이다.
 *     → 기사 자신의 fashion 크레딧에서 직접 읽는다(에디토리얼 SSR 과 동일 방식).
 *
 *  ③ 문의가 mailto 였다.
 *     메일 클라이언트가 안 열리면 그대로 이탈이고, 열려도 어느 브랜드 페이지가
 *     그 문의를 만들었는지 아무 데도 안 남는다. 유일하게 관측 가능한 전환점을
 *     계측 없이 버리고 있었다.
 *     → /business 문의 폼 + ?brand= 출처, 미디어킷은 계측 경유(경로형).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const FILE = 'api/seo/brand/[id].js';
const src = R(FILE);

console.log('\n=== ② 화보 목록 — 항상 최신 (매핑 테이블 의존 제거) ===');
t('공용 크레딧 파서를 쓴다', /require\('\.\.\/\.\.\/_lib\/fashionCredits'\)/.test(src) && /parseBrandCredits/.test(src),
  '구형 [{n,id}] 과 신형 {brands:[…]} 두 형태를 모두 읽어야 한다');
t('editorial_brands 매핑 테이블을 조회하지 않는다', !/from\('editorial_brands'\)/.test(src),
  '이 테이블은 2026-05-04 이후 적재가 없다 — 붙어 있는 한 목록은 계속 과거에 멈춘다');
t('발행분만 (status=published)', /\.eq\('status', 'published'\)/.test(src));
t('전건 스캔은 페이지네이션으로 (1000행 상한 회피)', /range\(from, from \+ PAGE - 1\)/.test(src),
  'supabase 기본 상한 때문에 페이지네이션 없이는 오래된 브랜드가 통째로 누락된다');
t('캐시로 스캔 비용 흡수 (1h edge + 24h SWR)', /s-maxage=3600, stale-while-revalidate=86400/.test(src));

console.log('=== ③ 문의 회복 — 폼 + 출처 + 계측 ===');
t('mailto 제거', !/mailto:/.test(src),
  'mailto 는 클라이언트가 안 열리면 이탈이고 리드 출처도 안 남는다');
t('문의 CTA 가 /business 폼으로', /\/business\?inquiry=1&brand=\$\{encodeURIComponent\(brand\.brand_id\)\}#inquiry/.test(src));
t('브랜드 id 를 인코딩해 넘긴다', /brand=\$\{encodeURIComponent/.test(src));
t('미디어킷은 경로형 계측 경유', /\/mediakit\/ko\/brand_\$\{encodeURIComponent\(brand\.brand_id\)\}/.test(src),
  '드라이브 직링크로 두면 어느 브랜드 담당자가 열었는지 영영 모른다');
t('매체 지표를 문의 버튼 바로 위에 노출', /430만/.test(src) && /52\.6%/.test(src) && /58\.7%/.test(src) && /서울/.test(src),
  '"화보에 나왔네" 다음에 버튼을 누를 근거가 없으면 그 자리에서 이탈한다');

/* CTA 가 폼에 도착해도 폼이 brand 파라미터를 안 읽으면 리드 출처는 그대로 사라진다.
 * ③은 "버튼을 바꿨다"가 아니라 "출처가 DB 에 남는다"까지가 완료다. */
console.log('=== ③ 착지 지점 — /business 가 brand 를 실제로 받는다 ===');
const biz = R('frontend/business.html');
const api = R('api/brand-inquiry.js');
t('#inquiry 앵커 존재 (링크가 착지할 곳)', /id="inquiry"/.test(biz));
t('?brand= 를 읽는다', /q\.get\('brand'\)/.test(biz));
t('브랜드명 프리필 (입력 마찰 제거)', /f\.brand_name\.value=raw/.test(biz));
t('source 를 brand_page:<id> 로 전송', /inqSource='brand_page:'\+raw/.test(biz) && /source:inqSource/.test(biz));
t('클라이언트 값은 정규화 후 사용', /replace\(\/\[\^a-z0-9\._-\]\/g,''\)/.test(biz),
  'URL 파라미터를 그대로 화면·DB 에 넣지 않는다');
/* 단발 스크롤은 라이브에서 실패했다(2026-07-30 실측: scrollY 0, 폼은 1165px 아래).
 * 페이지의 다른 초기화 스크립트가 뒤늦게 스크롤을 되돌리므로 재시도가 필수다. */
t('?inquiry=1 이면 폼으로 스크롤 (재시도 포함)',
  /q\.get\('inquiry'\)==='1'/.test(biz) && /window\.scrollTo/.test(biz)
  && /\[250,800,1500,2500\]/.test(biz),
  '단발 setTimeout 은 다른 스크립트에 밀려 무효화된다');
t('사용자가 직접 스크롤하면 방해하지 않는다', /_userMoved/.test(biz));
t('API 가 source 를 하드코딩하지 않는다', !/source: 'business_page'/.test(api) && /locale, source, status/.test(api),
  "'business_page' 고정이면 브랜드 페이지發 리드를 구분할 수 없다");
t('API 도 source 를 정규화 + 기본값', /replace\(\/\[\^a-z0-9_:\.-\]\/g, ''\)[\s\S]{0,40}\|\| 'business_page'/.test(api));
t('알림 메일 제목에 출처 표기', /source !== 'business_page' \? ' \(' \+ source \+ '\)'/.test(api));

console.log('=== 동작 실측 (가짜 supabase) ===');
(function () {
  // 같은 브랜드가 구형·신형 크레딧에 섞여 들어있고, 5월 이후 발행분도 있는 상태
  const EDS = [
    { title: 'Liminal Tides', slug: 'liminal-tides', id: 'e1', cover_image: 'https://x/a.jpg',
      published_date: '2026-07-25', fashion: [{ n: 'ZARA', id: '@zara' }, { n: 'Other', id: '@other' }] },
    { title: 'Old Shape', slug: 'old-shape', id: 'e2', cover_image: null,
      published_date: '2026-05-01', fashion: { brands: [{ name: 'ZARA', instagram: '@zara' }] } },
    { title: 'String JSON', slug: 'string-json', id: 'e3', cover_image: null,
      published_date: '2026-06-10', fashion: '[{"n":"ZARA","id":"zara"}]' },
    { title: 'Placeholder Only', slug: 'ph', id: 'e4', cover_image: null,
      published_date: '2026-06-01', fashion: [{ n: 'Brand', id: '@brand' }] },
  ];
  const orig = Module._load;
  Module._load = function (req) {
    const r = String(req);
    if (r.endsWith('_lib/supabase')) return { supabaseAdmin: { from(tb) {
      if (tb === 'brands') return { select: () => ({ eq: () => ({ neq: () => ({ limit: () => ({
        maybeSingle: () => Promise.resolve({ data: { brand_id: 'zara', display_name: 'ZARA',
          category: 'fashion', tier: null, instagram_handle: 'zara', status: 'pending' } }) }) }) }) }) };
      return { select: () => ({ eq: () => ({ not: () => ({ order: () => ({
        range: (from) => Promise.resolve({ data: from === 0 ? EDS : [] }) }) }) }) }) };
    } } };
    if (r.endsWith('_lib/cors')) return { handleCors: () => false };
    return orig.apply(this, arguments);
  };
  const handler = require('../' + FILE);
  Module._load = orig;

  const res = () => ({ _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, send(b) { this._b = b; return this; } });

  return (async () => {
    const r1 = res();
    await handler({ method: 'GET', query: { id: 'zara' }, headers: {} }, r1);
    const b = r1._b;
    t('200 응답', r1._c === 200);
    t('구형·신형·문자열 JSON 3형태 모두 집계 (3편)', /에디토리얼 <b style="color:#fff">3편<\/b>/.test(b),
      '한 형태만 읽으면 브랜드 페이지가 실제보다 빈약해 보인다');
    t('5/4 이후 발행분이 뜬다', b.includes('Liminal Tides'),
      '②의 본질 — 매핑 테이블을 봤다면 이 기사는 안 보인다');
    t('더미 크레딧(@brand) 기사는 제외', !b.includes('Placeholder Only'));
    t('문의 링크에 브랜드 출처', b.includes('/business?inquiry=1&brand=zara#inquiry'));
    t('미디어킷 계측 링크', b.includes('/mediakit/ko/brand_zara'));
    t('mailto 없음', !b.includes('mailto:'));
    t('index 허용 (화보가 있으므로)', /content="index,follow"/.test(b));

    // 크레딧이 하나도 안 걸리는 브랜드 → 얇은 페이지는 색인시키지 않는다
    const r2 = res();
    await handler({ method: 'GET', query: { id: 'nomatch' }, headers: {} }, r2);
    // brands 스텁이 항상 zara 를 돌려주므로 id 만 다를 뿐 화보는 매칭된다.
    // 여기서는 noindex 분기 자체가 살아있는지만 코드로 확인한다.
    t('화보 0편이면 noindex 분기 존재', /count \? 'index,follow' : 'noindex,follow'/.test(src),
      '내용 없는 페이지를 색인시키면 스케일 콘텐츠 남용으로 사이트 전체가 깎인다');

    console.log(`\npassed: ${pass}   failed: ${fail}`);
    if (fail) { console.log('❌ brand-page-inbound tests FAILED'); process.exit(1); }
    console.log('✅ brand-page-inbound tests passed');
  })();
})();
