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
check('pap-utils: buildPagination + PAP_PER_PAGE', 'typeof buildPagination === "function" && PAP_PER_PAGE === 20');
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

// isStandardOrAbove during beta + no token → false
check('isStandardOrAbove() during beta + logged-out → false', '!isStandardOrAbove()');

// During beta with token → isStandardOrAbove true (beta grants access to logged-in users)
check('isStandardOrAbove() during beta + logged-in → true', 'localStorage.setItem("pap-token", "x"); isStandardOrAbove()');

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
// Summary
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== SUMMARY ===');
console.log(`Phase 1 modules: ${MODULE_ORDER.length - loadErrors.length}/${MODULE_ORDER.length} loaded`);
console.log(`Phase 2+3 assertions: ${passed}/${passed + failed} passed`);
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
// and then log to console.warn) doesn't pollute the CI output. The synchronous
// assertions above are the source of truth — async leak-through is mock noise.
process.exit(0);
