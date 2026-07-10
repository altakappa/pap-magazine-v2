// PAP Magazine — Harness integration test
//
// Loads all 15 frontend modules in HTML order into a single Node vm context
// with a comprehensive browser-globals mock, then asserts that every module
// exposes its expected public API and that key cross-module behaviors work.
//
// Run with `node tests/harness-integration.test.js` (or `npm test`).
// Exits non-zero on any failure — wired into .github/workflows/test.yml so
// PRs that break the harness layout fail CI.
//
// Why vm + a custom mock instead of a real browser (jsdom / playwright)?
// 1. zero npm dependencies — runs on a fresh `npm ci` in seconds
// 2. exercises the actual classic-script realm semantics (`var X` → window,
//    cross-script `const T` access via shared lexical environment) that the
//    harness layout depends on
// 3. catches regressions like "module renamed but HTML script tag missed"
//    that linting can't see

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.resolve(__dirname, '..', 'frontend');

// Module load order MUST match every HTML's script tag chain.
// Update this list in lockstep with the HTML files.
const MODULE_ORDER = [
  'pap-utils.js',
  'pap-i18n.js',
  'pap-auth.js',
  'pap-search.js',
  'pap-static.js',
  'pap-subscription.js',
  'pap-home.js',
  'pap-content-editorial.js',
  'pap-content-film.js',
  'pap-content-article.js',
  'pap-content-creator-shorts.js',
  'pap-content-api-sync.js',
  'pap-content-seo.js',
  'pap-shell-bootstrap.js',
  'pap-app.js',
];

const HTMLS_LOADING_FULL_CHAIN = [
  'about.html', 'articles.html', 'business.html', 'community.html',
  'contact.html', 'films.html', 'index.html', 'pullletter.html',
  'submission.html', 'subscribe.html',
];

// ─────────────────────────────────────────────────────────────────────────
// Browser-globals mock
//
// Just enough surface area to let every module's top-level code run without
// throwing. Real DOM behavior (carousel scroll, modal animation, fetch
// responses) doesn't matter for the layout/wiring assertions we make below.
// ─────────────────────────────────────────────────────────────────────────

function makeFakeEl(tag) {
  return {
    tag,
    _attrs: {},
    _children: [],
    style: new Proxy({}, {
      get: (t, k) => t[k] || '',
      set: (t, k, v) => { t[k] = v; return true; },
    }),
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, f) {
        if (f === true) this._set.add(c);
        else if (f === false) this._set.delete(c);
        else if (this._set.has(c)) this._set.delete(c);
        else this._set.add(c);
      },
      contains(c) { return this._set.has(c); },
    },
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) {
      const i = this._children.indexOf(c);
      if (i >= 0) this._children.splice(i, 1);
      return c;
    },
    insertBefore(c) { this._children.unshift(c); return c; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    focus() {},
    click() {},
    scrollTo() {},
    scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }; },
    get firstChild() { return this._children[0] || null; },
    get firstElementChild() { return this._children[0] || null; },
    get parentNode() { return null; },
    get parentElement() { return null; },
    get scrollLeft() { return 0; },
    set scrollLeft(_) {},
    get scrollWidth() { return 200; },
    get clientWidth() { return 200; },
    get scrollTop() { return 0; },
    set scrollTop(_) {},
    set innerHTML(v) { this._innerHTML = v; },
    get innerHTML() { return this._innerHTML || ''; },
    set textContent(v) { this._textContent = v; },
    get textContent() { return this._textContent || ''; },
    set src(v) { this._src = v; },
    get src() { return this._src || ''; },
    onerror: null,
    onclick: null,
    dataset: new Proxy({}, {
      get: (t, k) => t[k],
      set: (t, k, v) => { t[k] = v; return true; },
    }),
  };
}

function buildContext() {
  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Promise, JSON,
    Array, Object, String, Number, Boolean, Math, Error, RegExp, Map, Set, Proxy, Symbol,
    encodeURIComponent, decodeURIComponent,
    URLSearchParams,
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    requestAnimationFrame: cb => setTimeout(cb, 16),
    cancelAnimationFrame: clearTimeout,
    IntersectionObserver: class {
      constructor() {}
      observe() {} unobserve() {} disconnect() {}
    },
    MutationObserver: class {
      constructor() {}
      observe() {} disconnect() {}
    },
    Image: class {
      constructor() { this.onload = null; }
      set src(_) { /* no-op */ }
    },
    Event: class {
      constructor(type) { this.type = type; }
    },
  };

  // localStorage
  const _store = {};
  ctx.localStorage = {
    getItem(k) { return _store[k] != null ? _store[k] : null; },
    setItem(k, v) { _store[k] = String(v); },
    removeItem(k) { delete _store[k]; },
    clear() { for (const k of Object.keys(_store)) delete _store[k]; },
    _store,
  };

  // document
  const head = makeFakeEl('head');
  const body = makeFakeEl('body');
  ctx.document = {
    documentElement: { lang: '' },
    body,
    head,
    cookie: '',
    fonts: { ready: { then: cb => setTimeout(cb, 0) } },
    readyState: 'complete',
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement: tag => makeFakeEl(tag),
    createTextNode: t => ({ textContent: t }),
  };

  // window
  ctx.window = {
    location: {
      href: '', origin: 'https://www.pap-magazine.com',
      hostname: 'www.pap-magazine.com',
      pathname: '/', search: '', hash: '',
    },
    history: { pushState() {}, replaceState() {}, back() {}, forward() {}, state: null },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({
      matches: false,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
    }),
    scrollY: 0, scrollX: 0,
    scrollTo() {},
    innerWidth: 1280,
    innerHeight: 800,
    open() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
  };

  ctx.navigator = {
    language: 'ko',
    userLanguage: 'ko',
    maxTouchPoints: 0,
    userAgent: 'Mozilla/5.0 (test) Chrome/120.0',
  };

  ctx.global = ctx;
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
}

// ─────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push({ label, detail });
    failed++;
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1 — every module loads cleanly in HTML order
// ─────────────────────────────────────────────────────────────────────────

group('=== Phase 1: load all 15 modules in HTML order ===');

const ctx = buildContext();
const loadErrors = [];
for (const m of MODULE_ORDER) {
  const file = path.join(FRONTEND, m);
  if (!fs.existsSync(file)) {
    ok(`load ${m}`, false, 'file does not exist');
    continue;
  }
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: m });
    ok(`load ${m}`, true);
  } catch (e) {
    loadErrors.push({ module: m, error: e.message });
    ok(`load ${m}`, false, e.message.split('\n')[0]);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — public surface assertions (run inside vm so const/let are visible)
// ─────────────────────────────────────────────────────────────────────────

group('=== Phase 2: public API surface ===');

function check(label, code) {
  try {
    const result = vm.runInContext(code, ctx);
    ok(label, !!result);
  } catch (e) {
    ok(label, false, e.message.split('\n')[0]);
  }
}

// Foundation
check('pap-utils: lockScroll/unlockScroll', 'typeof lockScroll === "function" && typeof unlockScroll === "function"');
check('pap-utils: escapeHtml/_decHtml/_normWs', 'typeof escapeHtml === "function" && typeof _decHtml === "function" && typeof _normWs === "function"');
check('pap-utils: buildPagination + PAP_PER_PAGE', 'typeof buildPagination === "function" && PAP_PER_PAGE === 30');
check('pap-utils: carousel helpers', 'typeof _papUpdateArrows === "function" && typeof _papWireCarousel === "function" && typeof _papSmoothScrollBy === "function"');

// i18n
check('pap-i18n: T has 9 langs', 'typeof T === "object" && Object.keys(T).length === 9');
check('pap-i18n: T.ko.about === "ABOUT"', 'T.ko.about === "ABOUT"');
check('pap-i18n: lang is "ko" by default (or whatever localStorage seeded)', 'typeof lang === "string" && lang.length === 2');
check('pap-i18n: setLang exposed', 'typeof setLang === "function"');
check('pap-i18n: _searchTexts consolidated (mission 4)', '_searchTexts && typeof _searchTexts.ko === "object"');
check('pap-i18n: _legalNoticeTexts consolidated (mission 7)', '_legalNoticeTexts && typeof _legalNoticeTexts.terms === "object"');
check('pap-i18n: _interstitialSkipTexts consolidated (mission 10)', '_interstitialSkipTexts.ko === "건너뛰기"');
check('pap-i18n: _interstitialPremTexts consolidated', 'typeof _interstitialPremTexts.en === "string"');
check('pap-i18n: _interstitialUpsellTexts has 9 langs', 'Object.keys(_interstitialUpsellTexts).length === 9');
check('pap-i18n: _imageProtectMsg consolidated', 'typeof _imageProtectMsg.ko === "string"');

// Auth
check('pap-auth: isLoggedIn / _papLogout / _papUpdateAuthDropdown', 'typeof isLoggedIn === "function" && typeof _papLogout === "function" && typeof _papUpdateAuthDropdown === "function"');
check('pap-auth: toggleAccountMenu / _closeAcct', 'typeof toggleAccountMenu === "function" && typeof _closeAcct === "function"');
check('pap-auth: isLoggedIn() === false on empty storage', 'isLoggedIn() === false');

// Search
check('pap-search: toggleSearch / searchEditorials', 'typeof toggleSearch === "function" && typeof searchEditorials === "function"');

// Static
check('pap-static: openPage / closePage', 'typeof openPage === "function" && typeof closePage === "function"');

// Subscription
check('pap-subscription: isPremium / isStandardOrAbove', 'typeof isPremium === "function" && typeof isStandardOrAbove === "function"');
check('pap-subscription: showPremiumInterstitial / navigateWithInterstitial', 'typeof showPremiumInterstitial === "function" && typeof navigateWithInterstitial === "function"');

// Home
check('pap-home: _resetCursorForModal / closeSignupPopup', 'typeof _resetCursorForModal === "function" && typeof closeSignupPopup === "function"');

// Content — Editorial
check('pap-content-editorial: edData / edDetails / openEditorial', 'Array.isArray(edData) && typeof edDetails === "object" && typeof openEditorial === "function"');
check('pap-content-editorial: open/close family', 'typeof closeEditorial === "function" && typeof _openEditorialInner === "function" && typeof _openEditorialInner_noPush === "function"');
check('pap-content-editorial: openAllEditorials / closeAllEditorials / filterEditorialsByCategory', 'typeof openAllEditorials === "function" && typeof closeAllEditorials === "function" && typeof filterEditorialsByCategory === "function"');
check('pap-content-editorial: edImgError', 'typeof edImgError === "function"');

// Content — Film
check('pap-content-film: filmAllData / openAllFilms / openFilmDetail', 'Array.isArray(filmAllData) && typeof openAllFilms === "function" && typeof openFilmDetail === "function"');
check('pap-content-film: closeAllFilms / closeFilmDetail / _findFilmByTitle', 'typeof closeAllFilms === "function" && typeof closeFilmDetail === "function" && typeof _findFilmByTitle === "function"');
check('pap-content-film: filmSlug / filmPageUrl / playFilm / stopFilm', 'typeof filmSlug === "function" && typeof filmPageUrl === "function" && typeof playFilm === "function" && typeof stopFilm === "function"');

// Content — Article
check('pap-content-article: artData / openArticleDetail / closeArticleDetail', 'Array.isArray(artData) && typeof openArticleDetail === "function" && typeof closeArticleDetail === "function"');
check('pap-content-article: openAllArticles / closeAllArticles', 'typeof openAllArticles === "function" && typeof closeAllArticles === "function"');
check('pap-content-article: openArticleBySlug / openArticleFromCard', 'typeof openArticleBySlug === "function" && typeof openArticleFromCard === "function"');

// Content — Creator + Shorts
check('pap-content-creator-shorts: creatorData / openCreatorPopup / getCreatorDB', 'Array.isArray(creatorData) && typeof openCreatorPopup === "function" && typeof getCreatorDB === "function"');
check('pap-content-creator-shorts: shortsData / moveShort', 'Array.isArray(shortsData) && typeof moveShort === "function"');

// Content — API Sync
check('pap-content-api-sync: render hooks set on window', 'typeof window._papShortsRender === "function" && typeof window._papFilmAutoPlay === "function"');

// Content — SEO
check('pap-content-seo: _updateEditorialMeta / _resetEditorialMeta', 'typeof _updateEditorialMeta === "function" && typeof _resetEditorialMeta === "function"');

// Shell bootstrap
check('pap-shell-bootstrap: isBetaActive / PAP_BETA_END', 'typeof isBetaActive === "function" && typeof PAP_BETA_END === "string"');
check('pap-shell-bootstrap: getLangText', 'typeof getLangText === "function"');
check('pap-shell-bootstrap: toggleNav / closeNav', 'typeof toggleNav === "function" && typeof closeNav === "function"');
check('pap-shell-bootstrap: moveCarousel / moveEdCarousel / scrollEdRow', 'typeof moveCarousel === "function" && typeof moveEdCarousel === "function" && typeof scrollEdRow === "function"');

// ─────────────────────────────────────────────────────────────────────────
// Phase 3 — cross-module behavioral assertions
// ─────────────────────────────────────────────────────────────────────────

group('=== Phase 3: cross-module behaviors ===');

// setLang flows through to localStorage
check('setLang("en") sets localStorage("pap-lang") to "en"', 'setLang("en"); localStorage.getItem("pap-lang") === "en" && lang === "en"');

// localStorage token check propagates to isLoggedIn
check('localStorage.setItem("pap-token", x) → isLoggedIn() true', 'localStorage.setItem("pap-token", "fake.jwt"); isLoggedIn()');
check('localStorage.removeItem("pap-token") → isLoggedIn() false (no user)', 'localStorage.removeItem("pap-token"); !isLoggedIn()');

// ── 2026-07-10 베타 종료 → tier-strict semantics ──────────────────────────
// PAP_BETA_END가 과거로 설정되어 isBetaActive()는 항상 false여야 한다.
// (누군가 실수로 베타를 재활성화하면 여기서 잡힌다)
check('isBetaActive() → false (베타 종료, 정식 오픈)', '!isBetaActive()');

// logged-out → false
check('isStandardOrAbove() post-beta + logged-out → false',
  'localStorage.removeItem("pap-token"); localStorage.removeItem("pap-user"); !isStandardOrAbove()');

// 로그인만으로는 더 이상 접근 불가 (베타 시절 특례 종료)
check('isStandardOrAbove() post-beta + logged-in without subscription → false',
  'localStorage.setItem("pap-token", "x"); !isStandardOrAbove()');

// standard 구독자 → standard true / premium false
check('isStandardOrAbove() post-beta + standard subscriber → true (isPremium false)',
  'localStorage.setItem("pap-user", JSON.stringify({subscription:"standard"})); isStandardOrAbove() && !isPremium()');

// premium 구독자 → 둘 다 true
check('isPremium() post-beta + premium subscriber → true',
  'localStorage.setItem("pap-user", JSON.stringify({subscription:"premium"})); isPremium() && isStandardOrAbove()');

// 다음 검사들에 영향 없도록 정리
check('tier-check cleanup: pap-user/pap-token removed → false',
  'localStorage.removeItem("pap-user"); localStorage.removeItem("pap-token"); !isStandardOrAbove()');

// edImgError sets fallback on a fake img
check('edImgError sets img.dataset.fallback = "1" then again is no-op', `
  const fakeImg = { dataset: {}, alt: 'Test', src: 'broken.jpg' };
  edImgError(fakeImg);
  fakeImg.dataset.fallback === '1' && fakeImg.src.startsWith('data:image/svg+xml');
`);

// navigateWithInterstitial doesn't throw
check('navigateWithInterstitial does not throw', `
  let threw = false;
  try { navigateWithInterstitial('/somewhere'); } catch(e) { threw = true; }
  !threw;
`);

// ─────────────────────────────────────────────────────────────────────────
// Phase 4 — HTML script-tag layout
//
// Walk every HTML that loads pap-app.js and verify the 15 script tags are
// present and in the correct order. Catches "added new module but missed an
// HTML" regressions.
// ─────────────────────────────────────────────────────────────────────────

group('=== Phase 4: HTML script-tag layout ===');

const expectedTags = MODULE_ORDER.map(m => m.replace(/\.js$/, ''));

for (const html of HTMLS_LOADING_FULL_CHAIN) {
  const file = path.join(FRONTEND, html);
  if (!fs.existsSync(file)) {
    ok(`${html}: file exists`, false);
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');
  const found = [];
  // Match both relative (legacy) and absolute (post-cleanup) script src.
  const re = /src="\/?(pap-[a-z0-9-]+)\.js/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    if (expectedTags.includes(match[1])) found.push(match[1]);
  }
  // Compare in order
  const good = found.length === expectedTags.length
    && found.every((t, i) => t === expectedTags[i]);
  ok(`${html}: 15 script tags in correct order`, good,
     good ? '' : `got [${found.join(', ')}]`);
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 5 — API sync callbacks, SUCCESS path
//
// 2026-07-10 프로덕션 장애 재발 방지: `_apiSynced` 가 lazy-load IIFE 지역
// 스코프에 var 로 선언돼 sync 콜백(별도 스코프)에서 ReferenceError 가 났고,
// API 동기화 전체가 죽어 사이트 카드가 스켈레톤으로 남았다. 기존 하네스는
// fetch 목이 `{ok:false}` 만 돌려줘 "데이터가 실제로 도착한 뒤 실행되는
// 콜백 경로"를 한 번도 타지 않아 이를 잡지 못했다.
//
// 이 페이즈는 fetch 를 실제 API 응답 형태({data, pagination})로 스텁한
// 새 컨텍스트에 15개 모듈을 다시 로드하고, syncEditorials / syncFilms /
// syncArticles 의 성공 경로가 끝까지 실행되는지 검증한다:
//   • window._apiSynced 3개 플래그가 전부 세팅되는가 (콜백 완주 증명)
//   • API 아이템이 edData / filmAllData / artData 에 실제로 머지되는가
//   • 실행 중 ReferenceError 계열 unhandled rejection 이 없는가
// ─────────────────────────────────────────────────────────────────────────

const API_SAMPLE = {
  film: {
    id: 'test-film-uuid', title: 'Harness Test Film', youtube_id: 'dQw4w9WgXcQ',
    thumbnail_url: 'https://example.com/f.jpg', published_date: '2026-07-10',
    categories: ['Film'], tags: ['test'], credits: [], slug: 'harness-test-film',
  },
  article: {
    id: 'test-article-uuid', title: 'Harness Test Article', subtitle: 'sub',
    content: '[{"type":"text","content":"hello"}]', published_date: '2026-07-10',
    slug: 'harness-test-article', custom_url: '', category: 'Fashion',
    thumbnail_url: 'https://example.com/a.jpg', hero_image_url: '',
    tags: [], credits: [],
  },
  editorial: {
    id: 'test-editorial-uuid', title: 'Harness Test Editorial',
    slug: 'harness-test-editorial', thumbnail: 'https://example.com/e.jpg',
    cover_image: 'https://example.com/e-cover.jpg', published_date: '2026-07-10',
    tags: ['test'], credits: [], gallery: [], related_films: [],
    issue: 'JUL. 2026 ISSUE', description: 'test', description_en: 'test',
    source_instagram_url: '',
  },
};

function buildSyncContext() {
  const c = buildContext();
  // idle 콜백을 즉시 실행시켜 테스트 대기시간 단축 (구현은 setTimeout 폴백과 동일 경로)
  c.requestIdleCallback = (cb) => setTimeout(cb, 0);
  c.fetch = (url) => {
    url = String(url);
    const respond = (obj) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });
    const page = (item) => respond({ data: [item], pagination: { page: 1, pages: 1, total: 1 } });
    if (url.indexOf('/api/films') !== -1) return page(API_SAMPLE.film);
    if (url.indexOf('/api/articles') !== -1) return page(API_SAMPLE.article);
    if (url.indexOf('/api/editorials') !== -1) return page(API_SAMPLE.editorial);
    // 그 외(정적 JSON, 기타 엔드포인트)는 기존 목과 동일하게 무해한 실패
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  };
  return c;
}

(async function phase5AndSummary() {
  group('=== Phase 5: API sync callbacks (success path) ===');

  const ctx2 = buildSyncContext();
  let syncLoadFailed = null;
  for (const m of MODULE_ORDER) {
    try {
      vm.runInContext(fs.readFileSync(path.join(FRONTEND, m), 'utf8'), ctx2, { filename: 'sync:' + m });
    } catch (e) { syncLoadFailed = m + ': ' + e.message.split('\n')[0]; break; }
  }
  ok('sync context: all modules reloaded with data-stubbed fetch', !syncLoadFailed, syncLoadFailed);

  // sync 실행 중 발생하는 스코프 오류(ReferenceError)를 잡는다.
  // (mock DOM 특성상 발생 가능한 TypeError 노이즈와 구분하기 위해
  //  ReferenceError 계열만 실패로 친다 — 2026-07-10 장애가 정확히 이 유형)
  const refErrors = [];
  const onRejection = (err) => {
    if (err && err.name === 'ReferenceError') refErrors.push(err);
  };
  process.on('unhandledRejection', onRejection);

  // 트리거 체인: readyState 'complete' → setTimeout(100) → syncEditorials +
  // idle(syncFilms/syncArticles). 플래그 3개가 다 설 때까지 폴링 (최대 5초).
  const allFlagsSet = () => {
    try {
      return vm.runInContext(
        'window._apiSynced && window._apiSynced.films === true && window._apiSynced.articles === true && window._apiSynced.editorials === true',
        ctx2);
    } catch (_) { return false; }
  };
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !allFlagsSet()) {
    await new Promise(r => setTimeout(r, 50));
  }
  // 남은 마이크로태스크/타이머 정리 여유
  await new Promise(r => setTimeout(r, 100));
  process.removeListener('unhandledRejection', onRejection);

  const flag = (k) => {
    try { return vm.runInContext(`window._apiSynced && window._apiSynced.${k} === true`, ctx2); }
    catch (_) { return false; }
  };
  ok('sync callback: _apiSynced.editorials set (syncEditorials 완주)', flag('editorials'));
  ok('sync callback: _apiSynced.films set (syncFilms 완주)', flag('films'));
  ok('sync callback: _apiSynced.articles set (syncArticles 완주)', flag('articles'));

  const merged = (expr) => { try { return vm.runInContext(expr, ctx2); } catch (_) { return false; } };
  ok('sync merge: API editorial merged into edData',
     merged('edData.some(function(e){ return e._api_id === "test-editorial-uuid"; })'));
  ok('sync merge: API film merged into filmAllData',
     merged('filmAllData.some(function(f){ return f._api_id === "test-film-uuid"; })'));
  ok('sync merge: API article merged into artData',
     merged('artData.some(function(a){ return a._api_id === "test-article-uuid"; })'));

  ok('sync run: no ReferenceError during sync callbacks (scope regression guard)',
     refErrors.length === 0,
     refErrors[0] ? String(refErrors[0].message || refErrors[0]) : '');

  // ───────────────────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────────────────

  console.log('\n=== SUMMARY ===');
  console.log(`Phase 1 modules: ${MODULE_ORDER.length - loadErrors.length}/${MODULE_ORDER.length} loaded`);
  console.log(`Phase 2+3+5 assertions: ${passed}/${passed + failed} passed`);
  console.log(`Phase 4 HTMLs: ${HTMLS_LOADING_FULL_CHAIN.length} checked`);

  if (failed > 0 || loadErrors.length > 0) {
    console.log('\n⚠  FAILURES:');
    for (const f of failures) console.log(`  - ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
    for (const e of loadErrors) console.log(`  - load ${e.module}: ${e.error.split('\n')[0]}`);
    process.exit(1);
  }

  console.log('\n✓ All checks passed.');
  // Explicit exit so post-test async noise from the modules' fetch IIFEs
  // (which chain `.then(j => ...j.x...)` on our `{ok:false, json:null}` mock
  // and then log to console.warn) doesn't pollute the CI output. The
  // assertions above are the source of truth — async leak-through is mock noise.
  process.exit(0);
})();
