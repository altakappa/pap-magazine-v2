/**
 * PAP Magazine — 하드코딩 한글 UI 텍스트의 런타임 번역 (2026-09-09)
 * ═══════════════════════════════════════════════════════════════════
 * 배경(도메니코): "영문으로 설정했으나 한글로 나오는 부분이 분명 있어. 모두 9개 언어 전부 적용."
 *
 * 기존 i18n(pap-i18n.js·페이지별 L 사전)은 data-i18n 표시가 붙은 요소만 바꾼다.
 * 그 표시가 없는 한글(약관 본문·SEO 랜딩·비즈니스 소개·소형 안내 등 1,221개 문자열,
 * 27개 공개 페이지)은 어떤 언어를 골라도 한글로 남았다. 마크업을 전부 손대는 대신,
 * 페이지별 "한글 원문 → 번역" 사전(/i18n/ui/<page>.<lang>.json)을 두고 이 스크립트가
 * 텍스트 노드와 속성(placeholder·title·alt·aria-label·버튼 value)을 바꿔 끼운다.
 *
 * 원칙
 *  · 한국어(ko)면 아무것도 안 한다(사전 요청도 없음). 원문은 WeakMap 에 보관해 ko 로
 *    돌아오면 복원한다.
 *  · data-i18n / data-i18n-html / translate="no" / data-ui-i18n-skip 아래는 건드리지 않는다
 *    (기존 사전이 담당하거나 번역 금지 구역).
 *  · 법률 페이지(meta data-legal="1")는 번역 위에 "한국어 원문이 법적 효력을 가진다" 안내를
 *    붙인다. pap-static.js 의 홈 약관 모달과 같은 원칙.
 *  · 동적 렌더(SPA)도 MutationObserver 로 따라간다(150ms 스로틀). 텍스트 값 변경은
 *    characterData 라 childList 옵저버를 다시 깨우지 않는다 → 무한루프 없음.
 *
 * 사전은 tests/ui-i18n-coverage.test.js 가 "모든 키에 8개 언어가 다 있는가"를 지킨다.
 */
(function () {
  'use strict';
  var META = document.querySelector('meta[name="pap-ui-i18n"]');
  if (!META) return;
  var PAGE = META.getAttribute('content');
  var VER = META.getAttribute('data-v') || '1';
  var LEGAL = META.getAttribute('data-legal') === '1';
  var LANGS = ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
  var HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
  var cache = {};      // lang -> map
  var loading = {};    // lang -> Promise
  var ORIG = new WeakMap();      // text node -> original nodeValue
  var ORIG_ATTR = new WeakMap(); // element -> { attr: original }
  var touchedNodes = [];         // 복원용(ko 로 돌아올 때)
  var touchedEls = [];

  function cur() { try { return localStorage.getItem('pap-lang') || 'ko'; } catch (_) { return 'ko'; } }
  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

  function load(lang) {
    if (cache[lang]) return Promise.resolve(cache[lang]);
    if (loading[lang]) return loading[lang];
    loading[lang] = fetch('/i18n/ui/' + PAGE + '.' + lang + '.json?v=' + VER)
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { cache[lang] = j || {}; return cache[lang]; })
      .catch(function () { cache[lang] = {}; return cache[lang]; });
    return loading[lang];
  }

  function skip(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      var tn = e.tagName;
      if (tn === 'SCRIPT' || tn === 'STYLE' || tn === 'CODE' || tn === 'PRE' || tn === 'TEXTAREA' || tn === 'NOSCRIPT') return true;
      if (e.hasAttribute('data-i18n') || e.hasAttribute('data-i18n-html') || e.hasAttribute('data-ui-i18n-skip')) return true;
      if (e.getAttribute('translate') === 'no') return true;
      if (e.id === '_papUiLegalNotice') return true;
    }
    return false;
  }

  function applyText(lang, map) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var n, nodes = [];
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var parent = node.parentNode;
      if (!parent || skip(parent)) return;
      var orig = ORIG.get(node);
      var raw = orig !== undefined ? orig : node.nodeValue;
      var key = norm(raw);
      if (!key || !HANGUL.test(key)) return;
      var t = map[key];
      if (!t) return;
      if (orig === undefined) { ORIG.set(node, raw); touchedNodes.push(node); }
      var lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
      var next = lead + t + trail;
      if (node.nodeValue !== next) node.nodeValue = next;
    });
    // <title>
    var titleEl = document.querySelector('title');
    if (titleEl && titleEl.firstChild) {
      var tn = titleEl.firstChild;
      var to = ORIG.get(tn); var traw = to !== undefined ? to : tn.nodeValue;
      var tk = norm(traw); var tt = map[tk];
      if (tt && HANGUL.test(tk)) { if (to === undefined) { ORIG.set(tn, traw); touchedNodes.push(tn); } if (tn.nodeValue !== tt) tn.nodeValue = tt; }
    }
  }

  function applyAttrs(lang, map) {
    ['placeholder', 'title', 'alt', 'aria-label', 'value'].forEach(function (attr) {
      var els = document.querySelectorAll('[' + attr + ']');
      Array.prototype.forEach.call(els, function (el) {
        if (attr === 'value' && !(el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type || ''))) return;
        if (attr === 'placeholder' && el.hasAttribute('data-i18n-ph')) return;
        if (skip(el)) return;
        var store = ORIG_ATTR.get(el) || {};
        var raw = store[attr] !== undefined ? store[attr] : el.getAttribute(attr);
        var key = norm(raw);
        if (!key || !HANGUL.test(key)) return;
        var t = map[key];
        if (!t) return;
        if (store[attr] === undefined) { store[attr] = raw; ORIG_ATTR.set(el, store); touchedEls.push(el); }
        if (el.getAttribute(attr) !== t) el.setAttribute(attr, t);
      });
    });
  }

  function restoreKo() {
    touchedNodes.forEach(function (node) { var o = ORIG.get(node); if (o !== undefined && node.nodeValue !== o) node.nodeValue = o; });
    touchedEls.forEach(function (el) {
      var store = ORIG_ATTR.get(el) || {};
      Object.keys(store).forEach(function (attr) { if (el.getAttribute(attr) !== store[attr]) el.setAttribute(attr, store[attr]); });
    });
    var ln = document.getElementById('_papUiLegalNotice'); if (ln) ln.style.display = 'none';
  }

  // 법률 페이지 안내 — 한국어 원문이 구속력 있는 원본. pap-static.js(_legalNoticeTexts)와 같은 취지.
  var LEGAL_NOTICE = {
    en: '<strong>Reference translation.</strong> The Korean version of this page is the legally binding original. This translation is provided for convenience only.',
    de: '<strong>Referenzübersetzung.</strong> Die koreanische Fassung dieser Seite ist die rechtsverbindliche Originalversion. Diese Übersetzung dient nur der Orientierung.',
    it: '<strong>Traduzione di riferimento.</strong> La versione coreana di questa pagina è l\'originale legalmente vincolante. Questa traduzione è fornita solo per comodità.',
    fr: '<strong>Traduction de référence.</strong> La version coréenne de cette page constitue l\'original juridiquement contraignant. Cette traduction est fournie à titre indicatif.',
    es: '<strong>Traducción de referencia.</strong> La versión coreana de esta página es el original legalmente vinculante. Esta traducción se ofrece solo como orientación.',
    ja: '<strong>参考翻訳。</strong> 本ページの韓国語版が法的拘束力を持つ正式版です。この翻訳は参考のために提供されています。',
    zh: '<strong>参考翻译。</strong> 本页面的韩文版本为具有法律约束力的正式版本。本翻译仅供参考。',
    ru: '<strong>Справочный перевод.</strong> Корейская версия этой страницы является юридически обязательным оригиналом. Перевод приводится только для удобства.'
  };
  function legalNotice(lang) {
    if (!LEGAL) return;
    var el = document.getElementById('_papUiLegalNotice');
    if (!el) {
      el = document.createElement('div');
      el.id = '_papUiLegalNotice';
      el.setAttribute('data-ui-i18n-skip', '1');
      el.style.cssText = 'max-width:900px;margin:0 auto 20px;padding:10px 14px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.04);font-size:12px;line-height:1.6;color:rgba(255,255,255,.75)';
      var host = document.querySelector('main') || document.body;
      host.insertBefore(el, host.firstChild);
    }
    var html = LEGAL_NOTICE[lang] || LEGAL_NOTICE.en;
    if (el.innerHTML !== html) el.innerHTML = html;   // 같은 값 재설정 금지 — 옵저버 재진입 방지
    if (el.style.display !== 'block') el.style.display = 'block';
  }

  var applying = false;
  function run() {
    var lang = cur();
    if (LANGS.indexOf(lang) === -1) { restoreKo(); return; }
    load(lang).then(function (map) {
      if (cur() !== lang) return;
      applying = true;
      try { applyText(lang, map); applyAttrs(lang, map); legalNotice(lang); } finally { applying = false; }
    });
  }

  // 언어 전환 훅 — pap-i18n.js 의 setLang 은 'pap:langchange' 를 쏜다.
  // 페이지 전용 setLang 만 있는 곳을 위해 전역 setLang 도 감싼다.
  window.addEventListener('pap:langchange', function () { setTimeout(run, 0); });
  function wrapSetLang() {
    var g = window.setLang;
    if (typeof g !== 'function' || g._papUiI18nWrapped) return;
    var w = function () { var r; try { r = g.apply(this, arguments); } finally { setTimeout(run, 0); } return r; };
    w._papUiI18nWrapped = true;
    window.setLang = w;
  }

  var mo = null, moTimer = null;
  function observe() {
    if (mo || !document.body) return;
    mo = new MutationObserver(function () {
      if (applying || cur() === 'ko') return;
      if (moTimer) return;
      moTimer = setTimeout(function () { moTimer = null; run(); }, 150);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function boot() { wrapSetLang(); setTimeout(wrapSetLang, 0); run(); observe(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window._papUiI18nApply = run;
})();
