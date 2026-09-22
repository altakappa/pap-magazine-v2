'use strict';
/**
 * 홈 전체-카탈로그 · 정적 시드 · 무거운 라이브러리 — "쓸 때만 받는다" (2026-09-22)
 * ═══════════════════════════════════════════════════════════════════════
 * 테크 매니저(픽셀) 속도 연구 실측(홈 · 첫 방문):
 *   /api/articles 28쪽 + /api/editorials 23쪽 = 51 요청, 압축 해제 24.6MB — 화면엔 12건만 보인다.
 *   첫 pointerdown 에도 즉시 시작하게 돼 있어 손가락이 닿는 순간 51 요청이 터졌다.
 *   정적 JSON: articles-snapshot 1.5MB(max-age=0, 홈에 그리는 곳 없음) · editorials.json 0.9MB ·
 *   editorial-details.json 2.6MB(9/16 게이트 이후 표지 1장짜리 껍데기).
 *   JSZip·jsPDF(≈460KB)·supabase-js(≈170KB)를 홈 첫 로드에 defer 로 받았다 — 다운로드·댓글 때만 쓴다.
 *
 * 고친 것
 *   ① 홈: 기사·에디토리얼 전량 동기화는 '전체 목록'을 열 때(papEnsureFullCatalog)만. 타이머·pointerdown 제거.
 *      홈의 검색창은 Enter 로 /search 페이지에 가므로(pap-search.js) 카탈로그가 필요 없다.
 *      필름 전량(2쪽)은 홈 필름 카드가 filmAllData 를 보므로 load 이후 유휴에 그대로 받는다.
 *   ② 홈: 정적 시드(articles-snapshot · editorials.json)는 목록을 열 때, editorial-details.json 은 안 받는다.
 *      홈 화면 부품(films·creators·shorts)은 종전대로. 딥링크·홈 아닌 페이지는 종전 그대로.
 *   ③ 에디토리얼 전량 동기화에 &public=1 (STAGE 1 과 같은 슬림 컬럼).
 *   ④ JSZip·jsPDF 는 버튼 클릭 때(_papLoadScriptOnce), supabase-js 는 첫 사용 때(ensureSupabase) 받는다.
 *
 * 검증 방식: 정규식으로 훑는 게 아니라 pap-content-api-sync.js 를 가짜 window·document·fetch 로
 * 실제 실행해, 홈에서 어떤 URL 이 나가는지 / 목록을 열면 무엇이 추가로 나가는지 센다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sync = R('frontend/pap-content-api-sync.js');
const edJs = R('frontend/pap-content-editorial.js');
const artJs = R('frontend/pap-content-article.js');
const socJs = R('frontend/pap-social.js');
const idx = R('frontend/index.html');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ── pap-content-api-sync.js 를 실제로 돌린다 ───────────────────────────── */
function boot(pathname, opts) {
  opts = opts || {};
  const urls = [];
  const listeners = {};      // window/document 이벤트
  const idleCbs = [];
  const timers = [];
  const fakeFetch = (url) => {
    url = String(url);
    urls.push(url);
    const pageM = url.match(/page=(\d+)/);
    const page = pageM ? Number(pageM[1]) : 1;
    const isList = /\/api\/(articles|editorials|films)\?/.test(url);
    const body = isList
      ? { data: page === 1 ? [{ id: 'x' + page, title: 'T' + page, cover_image: 'c', published_date: '2026-09-01', gallery: [], credits: [], tags: [] }] : [], pagination: { pages: opts.pages || 3 } }
      : (url.indexOf('.json') > -1 ? [] : {});
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  const el = () => ({ innerHTML: '', textContent: '', style: {}, classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, setAttribute() {}, getAttribute: () => null, appendChild() {}, insertBefore() {}, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, children: [], remove() {} });
  const doc = {
    readyState: 'loading',
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: el,
    createDocumentFragment: el,
    addEventListener: (n, fn) => { (listeners['doc:' + n] = listeners['doc:' + n] || []).push(fn); },
    removeEventListener() {},
    body: el(), head: el(), documentElement: el(),
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    fetch: fakeFetch,
    document: doc,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    requestIdleCallback: (fn) => { idleCbs.push(fn); return idleCbs.length; },
    performance: { now: () => Date.now() },
    Date, Math, JSON, Object, Array, String, Number, Promise, Error, RegExp, encodeURIComponent, decodeURIComponent, parseInt, isNaN,
    // 다른 파일이 제공하는 전역 — 여기서는 껍데기
    filmAllData: [], artData: [], edData: [], edDetails: {}, shortsData: [], creatorData: [],
    _renderLatestRow() {}, _renderTrendingRow() {}, _renderThemeRows() {},
    buildShortsCarousel() {}, updateShortsPositions() {},
    IntersectionObserver: function () { return { observe() {}, disconnect() {} }; },
  };
  ctx.window = ctx;
  ctx.window.location = { pathname, hostname: 'pap-magazine.com', origin: 'https://pap-magazine.com', hash: '', search: '', protocol: 'https:' };
  ctx.window.addEventListener = (n, fn) => { (listeners['win:' + n] = listeners['win:' + n] || []).push(fn); };
  ctx.window.removeEventListener = () => {};
  ctx.window.innerWidth = 1200;
  vm.createContext(ctx);
  vm.runInContext(sync, ctx, { filename: 'pap-content-api-sync.js' });
  const fire = (key) => (listeners[key] || []).splice(0).forEach((fn) => { try { fn(); } catch (e) { throw e; } });
  const drainTimers = () => { while (timers.length) { const x = timers.shift(); try { x.fn(); } catch (_) {} } };
  const drainIdle = () => { while (idleCbs.length) { const fn = idleCbs.shift(); try { fn(); } catch (_) {} } };
  return { ctx, urls, fire, drainTimers, drainIdle, listeners };
}
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 12); i++) await tick(); }

(async () => {
  console.log('=== 1. 홈: 아무것도 안 누르면 전량 동기화·시드 요청이 0건 ===');
  {
    const b = boot('/');
    b.fire('doc:DOMContentLoaded');
    b.ctx.document.readyState = 'complete';
    b.fire('win:load');
    b.drainTimers(); b.drainIdle(); b.drainTimers();
    await settle(20);
    b.drainTimers(); b.drainIdle(); b.drainTimers();
    await settle(20);
    const u = b.urls;
    const edFast = u.filter((x) => /\/api\/editorials\?status=published&limit=12/.test(x)).length;
    const artFast = u.filter((x) => /\/api\/articles\?status=published&limit=12/.test(x)).length;
    const edFull = u.filter((x) => /\/api\/editorials\?status=published&limit=100/.test(x)).length;
    const artFull = u.filter((x) => /\/api\/articles\?status=published&limit=100/.test(x)).length;
    const films = u.filter((x) => /\/api\/films\?status=published&limit=100/.test(x)).length;
    t('최신 12건(STAGE 1) 두 종은 나간다', edFast === 1 && artFast === 1, JSON.stringify(u));
    t('기사 전량(limit=100) 요청이 0건', artFull === 0, String(artFull));
    t('에디토리얼 전량(limit=100) 요청이 0건', edFull === 0, String(edFull));
    t('필름 전량은 홈에서도 받는다(홈 필름 카드가 filmAllData 를 본다)', films >= 1, String(films));
    t('정적 시드 2종(articles-snapshot · editorials.json)을 받지 않는다',
      !u.some((x) => /articles-snapshot|data\/editorials\.json|data\/articles\.json/.test(x)), JSON.stringify(u));
    t('editorial-details.json 을 받지 않는다', !u.some((x) => /editorial-details\.json/.test(x)));
    t('홈 화면 부품(films·creators·shorts JSON)은 종전대로 받는다',
      ['data/films.json', 'data/creators.json', 'data/shorts.json'].every((f) => u.some((x) => x.indexOf(f) > -1)), JSON.stringify(u));
    t('pointerdown 리스너를 달지 않는다', !(b.listeners['doc:pointerdown'] || []).length);
    t('상태가 idle 이다', b.ctx.window._papCatalogState === 'idle', String(b.ctx.window._papCatalogState));

    console.log('\n=== 2. 홈: 전체 목록을 열면(papEnsureFullCatalog) 그때 받는다 ===');
    const before = b.urls.length;
    t('문이 열려 있다', typeof b.ctx.window.papEnsureFullCatalog === 'function');
    b.ctx.window.papEnsureFullCatalog();
    t('상태가 loading 으로 바뀐다', b.ctx.window._papCatalogState === 'loading', String(b.ctx.window._papCatalogState));
    await settle(30); b.drainTimers(); await settle(30); b.drainTimers(); await settle(30);
    const after = b.urls.slice(before);
    t('기사 전량 1쪽이 나간다', after.some((x) => /\/api\/articles\?status=published&limit=100&page=1/.test(x)), JSON.stringify(after));
    t('에디토리얼 전량이 &public=1 로 나간다', after.some((x) => /\/api\/editorials\?status=published&limit=100&page=1&public=1$/.test(x)), JSON.stringify(after));
    t('시드 2종(articles-snapshot · editorials.json)도 이때 받는다',
      after.some((x) => /articles-snapshot/.test(x)) && after.some((x) => /data\/editorials\.json/.test(x)), JSON.stringify(after));
    t('editorial-details.json 은 여전히 안 받는다', !after.some((x) => /editorial-details\.json/.test(x)));
    t('두 번 불러도 다시 받지 않는다', (() => { const n = b.urls.length; b.ctx.window.papEnsureFullCatalog(); return b.urls.length === n; })());
    await settle(40); b.drainTimers(); await settle(40); b.drainTimers(); await settle(40);
    t('두 전량이 끝나면 상태가 done', b.ctx.window._papCatalogState === 'done', String(b.ctx.window._papCatalogState));
  }

  console.log('\n=== 3. 홈이 아니면(목록·상세 화면) 종전대로 곧 돈다 ===');
  {
    const b = boot('/editorial');
    b.fire('doc:DOMContentLoaded');
    b.ctx.document.readyState = 'complete';
    b.fire('win:load');
    b.drainTimers(); b.drainIdle(); b.drainTimers();
    await settle(30); b.drainTimers(); b.drainIdle(); await settle(30);
    const u = b.urls;
    t('에디토리얼 전량이 사람 손 없이 나간다', u.some((x) => /\/api\/editorials\?status=published&limit=100&page=1&public=1/.test(x)), JSON.stringify(u));
    t('기사 전량도 나간다', u.some((x) => /\/api\/articles\?status=published&limit=100&page=1/.test(x)));
    t('정적 시드도 종전대로 받는다', u.some((x) => /data\/editorials\.json/.test(x)) && u.some((x) => /articles-snapshot/.test(x)), JSON.stringify(u));
  }

  console.log('\n=== 4. 딥링크(/editorial/<slug>)는 상세맵까지 즉시 ===');
  {
    const b = boot('/editorial/some-slug');
    b.fire('doc:DOMContentLoaded');
    await settle(5);
    t('editorial-details.json 을 즉시 받는다', b.urls.some((x) => /editorial-details\.json\?v=3/.test(x)), JSON.stringify(b.urls));
  }

  console.log('\n=== 5. 소스 계약 ===');
  t('fetchAll 이 extraQuery 를 받는다', /function fetchAll\(endpoint, converter, callback, extraQuery\)/.test(sync));
  t('홈 타이머(requestIdleCallback(_flushFullSyncs)) 가 사라졌다', !/requestIdleCallback\(_flushFullSyncs/.test(sync) && !/setTimeout\(_flushFullSyncs/.test(sync));
  t('toggleSearch 래핑(검색창 열면 전량)이 사라졌다 — 홈 검색은 /search 페이지로 간다', !/window\.toggleSearch = function/.test(sync));
  t('목록 열기가 카탈로그를 부른다 (에디토리얼)', /function _openAllEditorialsInner\(\)\{[\s\S]{0,1600}?papEnsureFullCatalog\(\)/.test(edJs));
  t('목록 열기가 카탈로그를 부른다 (기사)', /function _openAllArticlesInner\(\)\{[\s\S]{0,400}?papEnsureFullCatalog\(\)/.test(artJs));
  t('기사 목록은 전량 도착 시 다시 그려진다 (_papArtAllRefresh ↔ _afterArticlesFilled)',
    /window\._papArtAllRefresh=_renderArtAllGrid;/.test(artJs) && /_afterArticlesFilled[\s\S]{0,900}?_papArtAllRefresh\(\)/.test(sync));
  t('목록이 불러오는 중이면 LOADING 표시 (두 목록)', /LOADING…/.test(edJs) && /LOADING…/.test(artJs));
  t('불러오는 중엔 에디토리얼 업셀 숫자를 그리지 않는다', /if\(!_catLoading&&!premium&&edAllCurrentPage===totalPages/.test(edJs));
  t('크리에이터 DB 캐시를 카탈로그 도착 때 버린다', /window\.creatorDB = null/.test(sync));

  console.log('\n=== 6. 무거운 라이브러리는 쓸 때만 ===');
  t('index.html 에 supabase-js 태그가 없다', !/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/.test(idx));
  t('index.html 에 jszip·jspdf 태그가 없다', !/<script[^>]+(jszip|jspdf)/.test(idx));
  t('pap-social.js 가 첫 사용 때 SDK 를 붙인다 (ensureSupabase)', /function ensureSupabase\(\)/.test(socJs) && /SUPABASE_SDK_SRC = 'https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2'/.test(socJs));
  t('데이터 함수 5곳이 전부 ensureSupabase 를 거친다', (socJs.match(/ensureSupabase\(\)\.then\(function\(sb\)\{/g) || []).length === 5, String((socJs.match(/ensureSupabase\(\)\.then\(function\(sb\)\{/g) || []).length));
  t('100ms 폴링으로 SDK 를 기다리던 코드가 없다', !/waitInterval/.test(socJs));
  t('pap-content-editorial.js 가 JSZip·jsPDF 를 클릭 때 받는다',
    /function _papLoadScriptOnce\(src, isReady\)/.test(edJs)
    && /await _papLoadScriptOnce\(_PAP_JSPDF_SRC/.test(edJs) && /await _papLoadScriptOnce\(_PAP_JSZIP_SRC/.test(edJs)
    && /jszip\/3\.10\.1\/jszip\.min\.js/.test(edJs) && /jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/.test(edJs));
  t('실패 안내 문구는 그대로다', /PDF 라이브러리 로드 실패/.test(edJs) && /ZIP 라이브러리 로드 실패/.test(edJs));
  {
    /* _papLoadScriptOnce 를 실제로 돌린다 — 같은 URL 은 한 번만 붙이고, 이미 준비돼 있으면 안 붙인다 */
    const fnSrc = edJs.slice(edJs.indexOf('var _papScriptOnce = {};'), edJs.indexOf('window._papLoadScriptOnce = _papLoadScriptOnce;'));
    const appended = [];
    const ctx = { document: { querySelector: () => null, createElement: () => { const s = {}; return s; }, head: { appendChild: (s) => { appended.push(s); setImmediate(() => s.onload && s.onload()); } } }, Promise, setImmediate };
    vm.createContext(ctx);
    vm.runInContext(fnSrc + '\nvar ready=false;\nvar p1=_papLoadScriptOnce("https://x/a.js", function(){ return ready; });\nvar p2=_papLoadScriptOnce("https://x/a.js", function(){ return ready; });\nvar same=(p1===p2);\nready=true;\nvar p3=_papLoadScriptOnce("https://x/a.js", function(){ return ready; });', ctx);
    await settle(5);
    t('같은 URL 두 번 → <script> 한 번', appended.length === 1 && ctx.same === true, String(appended.length));
    const p3 = await ctx.p3;
    t('이미 준비됐으면 붙이지 않고 즉시 true', p3 === true && appended.length === 1);
  }

  console.log('\n=== 7. index.html 머리 ===');
  t('Inter 300 을 빼고 400~900 만 요청한다 (실측: 300 사용처 없음)', /family=Inter:wght@400;500;600;700;800;900/.test(idx) && !/Inter:wght@300/.test(idx));
  t('히어로 이미지 호스트 preconnect + preload', /<link rel="preconnect" href="https:\/\/igcazquhkwxtqsaqpznx\.supabase\.co">/.test(idx) && /<link rel="preload" as="image" fetchpriority="high" href="https:\/\/igcazquhkwxtqsaqpznx\.supabase\.co\/storage\/v1\/object\/public\/media\/uploads\/1782883490406_pbkv6ny169\.jpg">/.test(idx));
  t('preload 가 실제 첫 히어로 <img src> 와 같은 URL 이다', (() => {
    const pre = (idx.match(/<link rel="preload" as="image"[^>]*href="([^"]+)"/) || [])[1];
    const img = (idx.match(/<img class="hero-slide-img" src="([^"]+)"/) || [])[1];
    return !!pre && pre === img;
  })());
  t('pap-protect.js 태그는 하나다', (idx.match(/<script src="\/pap-protect\.js/g) || []).length === 1);

  console.log('\n=== 8. 캐시버스트 ===');
  const htmls = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html'));
  [['pap-content-api-sync', 128], ['pap-content-editorial', 91], ['pap-content-article', 53], ['pap-social', 9]].forEach(([f, min]) => {
    const vs = new Set();
    htmls.forEach((h) => (R('frontend/' + h).match(new RegExp(f + '\\.js\\?v=(\\d+)', 'g')) || []).forEach((m) => vs.add(Number(m.split('=')[1]))));
    t(f + '.js?v= 가 HTML 전체에서 하나이고 ≥' + min, vs.size === 1 && [...vs][0] >= min, [...vs].join(','));
  });

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ home-catalog-on-demand FAILED'); process.exit(1); }
  console.log('✅ home-catalog-on-demand passed');
})();
