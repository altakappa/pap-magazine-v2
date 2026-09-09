/**
 * PAP Magazine — 하드코딩 한글 UI 텍스트의 런타임 번역 (2026-09-09, v3 2026-09-10)
 * ═══════════════════════════════════════════════════════════════════
 * 배경(도메니코): "영문으로 설정했으나 한글로 나오는 부분이 분명 있어. 모두 9개 언어 전부 적용."
 * v3(도메니코): "자바스크립트가 동적으로 만드는 한글도 9개 언어. 단 하나도 남김 없이."
 *
 * 기존 i18n(pap-i18n.js·페이지별 L 사전)은 data-i18n 표시가 붙은 요소만 바꾼다.
 * 그 표시가 없는 한글(정적 본문 + JS 가 만들어 넣는 토스트·버튼·배지·서버 오류 메시지)은
 * 어떤 언어를 골라도 한글로 남았다. 마크업·JS 를 전부 손대는 대신, "한글 원문 → 번역" 사전을
 * 두고 이 스크립트가 텍스트 노드와 속성(placeholder·title·alt·aria-label·버튼 value)을 바꿔 끼운다.
 *
 * 사전 두 층
 *  · /i18n/ui/_shared.<lang>.json  공용 JS(pap-*.js)·서버 응답 메시지·SSR 공통 셸 문자열 — 모든 페이지가 읽는다
 *  · /i18n/ui/<page>.<lang>.json   그 페이지의 정적 본문 + 인라인 스크립트 문자열
 *
 * 맞추는 순서 (텍스트 노드 하나마다)
 *  1) 정확 일치        "댓글 보기"
 *  2) 자리표시자 패턴   "총 {0}장 중 {1}장이 더 있습니다"  → 정규식으로 값을 잡아 번역문에 되넣는다
 *  3) 부분 일치        노드 안의 알려진 한글 조각을 긴 것부터 바꾼다 ("Altro 뷰티 su" → "Altro Beauty su")
 *
 * 원칙
 *  · 한국어(ko)면 아무것도 안 한다. 원문은 WeakMap 에 보관해 ko 로 돌아오면 복원한다.
 *  · data-i18n / data-i18n-html / translate="no" / data-ui-i18n-skip 아래는 건드리지 않는다.
 *  · 법률 페이지(meta data-legal="1")는 "한국어 원문이 법적 효력을 가진다" 안내를 붙인다.
 *  · 동적 렌더(SPA·토스트·모달)는 MutationObserver(childList·characterData·속성)로 따라간다.
 *    내가 쓴 값과 같은 변경은 무시하므로 무한루프가 없다.
 *  · window._papUIL(ko,en) — 페이지들이 쓰는 헬퍼를 사전 기반으로 교체한다(종전엔 en 외 언어가 영어로 떨어짐).
 *  · alert/confirm/prompt 메시지도 사전을 거친다(DOM 밖이라 옵저버가 못 본다).
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
  var ATTRS = ['placeholder', 'title', 'alt', 'aria-label', 'value'];
  var PH = /\{[A-Za-z0-9_]+\}/, PH_G = /\{[A-Za-z0-9_]+\}/g;   // 자리표시자 {0} {n} {count}
  var cache = {};      // lang -> compiled dict {map, patterns, subRe, subMap}
  var loading = {};    // lang -> Promise
  var ORIG = new WeakMap();      // text node -> original nodeValue
  var WRITTEN = new WeakMap();   // text node -> 마지막으로 내가 쓴 값 (옵저버 루프 방지)
  var ORIG_ATTR = new WeakMap(); // element -> { attr: original }
  var WRITTEN_ATTR = new WeakMap();
  var touchedNodes = [];         // 복원용(ko 로 돌아올 때)
  var touchedEls = [];

  function cur() { try { return localStorage.getItem('pap-lang') || 'ko'; } catch (_) { return 'ko'; } }
  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function fetchJson(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
  }
  // 사전 컴파일: 정확 일치 map / {n} 패턴 / 부분 일치 정규식
  function compile(raw) {
    var map = {}, patterns = [], plain = [];
    Object.keys(raw).forEach(function (k) {
      var v = raw[k]; if (typeof v !== 'string' || !v) return;
      map[k] = v;
      if (PH.test(k)) {
        var parts = k.split(PH_G), idx = (k.match(PH_G) || []).map(function (m) { return m.slice(1, -1); });
        // 자리표시자가 맨 앞/뒤면 (.+?) 대신 (.*?) — 값이 비어도 맞는다
        var src = '^\\s*' + parts.map(escRe).join('(.*?)') + '\\s*$';
        try { patterns.push({ re: new RegExp(src), idx: idx, v: v, len: k.length }); } catch (_) {}
      } else {
        plain.push(k);
      }
    });
    patterns.sort(function (a, b) { return b.len - a.len; });
    // 부분 일치: 긴 키부터. 한 정규식에 너무 많이 넣으면 느려져 400개씩 쪼갠다.
    plain.sort(function (a, b) { return b.length - a.length; });
    var subRes = [];
    for (var i = 0; i < plain.length; i += 400) {
      try { subRes.push(new RegExp(plain.slice(i, i + 400).map(escRe).join('|'), 'g')); } catch (_) {}
    }
    return { map: map, patterns: patterns, subRes: subRes };
  }
  function load(lang) {
    if (cache[lang]) return Promise.resolve(cache[lang]);
    if (loading[lang]) return loading[lang];
    var base = '/i18n/ui/';
    loading[lang] = Promise.all([
      fetchJson(base + '_shared.' + lang + '.json?v=' + VER),
      PAGE && PAGE !== '_shared' ? fetchJson(base + PAGE + '.' + lang + '.json?v=' + VER) : Promise.resolve({})
    ]).then(function (arr) {
      var merged = {}; var k;
      for (k in arr[0]) merged[k] = arr[0][k];
      for (k in arr[1]) merged[k] = arr[1][k];   // 페이지 사전이 공용을 덮는다
      cache[lang] = compile(merged); return cache[lang];
    });
    return loading[lang];
  }

  // 부분 일치를 쓰지 않는 곳 — 기사·화보 본문(한국어 콘텐츠). 조각만 바꾸면 한국어 문장이 뒤섞인다.
  // 본문은 URL 언어(/en/article/…)로 통째 번역본을 받는 것이지 이 스크립트의 일이 아니다.
  var CONTENT_SEL = 'article, .seo-body, .seo-meta, .seo-desc-primary, .seo-desc-en, .seo-faq, .seo-tldr, .seo-related, .seo-credits, .seo-byline, .seo-tags, #artDetailTitle, #artDetailSub, #artDetailDesc, #artDetailCredits, #artDetailTags, #artFaq, #artMoreArticles, #edDetailTitle, #edDetailDesc, #edDetailCredits, #edDetailTags, #edDetailIssue, .ed-img-credit, .art-all-title, .art-all-sub, .ed-row-card-title, .detail-content, .detail-title, .md-comment-body, .md-comment-content, .comment-body, .cm-text, [data-ui-i18n-content]';
  function inContent(el) {
    try { return !!(el && el.closest && el.closest(CONTENT_SEL)); } catch (_) { return false; }
  }
  var SUB_MAX = 120;   // 부분 일치는 짧은 UI 문자열에만 (긴 글은 콘텐츠일 확률이 높다)

  // 텍스트 하나 번역. 못 바꾸면 null. allowSub=false 면 정확·패턴 일치만.
  function translate(dict, raw, allowSub) {
    var key = norm(raw);
    if (!key || !HANGUL.test(key)) return null;
    var t = dict.map[key];
    if (t) return t;
    var i, p, m;
    for (i = 0; i < dict.patterns.length; i++) {
      p = dict.patterns[i]; m = key.match(p.re);
      if (m) {
        var out = p.v;
        for (var j = 0; j < p.idx.length; j++) out = out.split('{' + p.idx[j] + '}').join(m[j + 1]);
        // 자리표시자 값 안에 남은 한글도 한 번 더
        if (HANGUL.test(out) && allowSub !== false) out = substitute(dict, out);
        return out;
      }
    }
    if (allowSub === false || key.length > SUB_MAX) return null;
    var s = substitute(dict, key);
    return s !== key ? s : null;
  }
  function substitute(dict, s) {
    for (var i = 0; i < dict.subRes.length; i++) {
      s = s.replace(dict.subRes[i], function (mm) { return dict.map[mm] || mm; });
      if (!HANGUL.test(s)) break;
    }
    return s;
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

  function setText(node, raw, t) {
    var lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
    var next = lead + t + trail;
    if (node.nodeValue !== next) { WRITTEN.set(node, next); node.nodeValue = next; }
  }
  function applyText(dict, root) {
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
    var n, nodes = [];
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var parent = node.parentNode;
      if (!parent || skip(parent)) return;
      var orig = ORIG.get(node);
      // 내가 쓴 뒤 남이 다시 바꿨으면(예: 카운터 갱신) 그 새 값을 원문으로 본다
      if (orig !== undefined && WRITTEN.get(node) !== node.nodeValue) { orig = undefined; ORIG.delete(node); }
      var raw = orig !== undefined ? orig : node.nodeValue;
      if (!HANGUL.test(raw)) return;
      var t = translate(dict, raw, !inContent(parent));
      if (!t) return;
      if (orig === undefined) { ORIG.set(node, raw); touchedNodes.push(node); }
      setText(node, raw, t);
    });
    // <title>
    var titleEl = document.querySelector('title');
    if (titleEl && titleEl.firstChild) {
      var tn = titleEl.firstChild;
      var to = ORIG.get(tn);
      if (to !== undefined && WRITTEN.get(tn) !== tn.nodeValue) { to = undefined; ORIG.delete(tn); }
      var traw = to !== undefined ? to : tn.nodeValue;
      var tt = HANGUL.test(traw) ? translate(dict, traw) : null;
      if (tt) { if (to === undefined) { ORIG.set(tn, traw); touchedNodes.push(tn); } if (tn.nodeValue !== tt) { WRITTEN.set(tn, tt); tn.nodeValue = tt; } }
    }
  }

  function applyAttrs(dict) {
    ATTRS.forEach(function (attr) {
      var els = document.querySelectorAll('[' + attr + ']');
      Array.prototype.forEach.call(els, function (el) {
        if (attr === 'value' && !(el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type || ''))) return;
        if (attr === 'placeholder' && el.hasAttribute('data-i18n-ph')) return;
        if (skip(el)) return;
        var store = ORIG_ATTR.get(el) || {};
        var wr = WRITTEN_ATTR.get(el) || {};
        var curV = el.getAttribute(attr);
        if (store[attr] !== undefined && wr[attr] !== curV) { delete store[attr]; }
        var raw = store[attr] !== undefined ? store[attr] : curV;
        if (!raw || !HANGUL.test(raw)) return;
        var t = translate(dict, raw);
        if (!t) return;
        if (store[attr] === undefined) { store[attr] = raw; ORIG_ATTR.set(el, store); if (touchedEls.indexOf(el) === -1) touchedEls.push(el); }
        if (curV !== t) { wr[attr] = t; WRITTEN_ATTR.set(el, wr); el.setAttribute(attr, t); }
      });
    });
  }

  // 법률 페이지 h1 은 "이용약관 <span.subtitle>Terms of Service</span>" 꼴이라 영어로 바꾸면
  // 같은 줄이 두 번 보인다(Terms of Service / Terms of Service). 번역 결과가 부제와 같으면 부제를 숨긴다.
  function dedupeSubtitle(show) {
    Array.prototype.forEach.call(document.querySelectorAll('h1 > .subtitle'), function (sub) {
      var h = sub.parentNode, main = '';
      Array.prototype.forEach.call(h.childNodes, function (c) { if (c.nodeType === 3) main += c.nodeValue; });
      if (sub._papOrigDisplay === undefined) sub._papOrigDisplay = sub.style.display; // 원래 inline style(display:block) 보존
      var same = show && norm(main).toLowerCase() === norm(sub.textContent).toLowerCase();
      var want = same ? 'none' : sub._papOrigDisplay;
      if (sub.style.display !== want) sub.style.display = want;
    });
  }

  function restoreKo() {
    dedupeSubtitle(false);
    touchedNodes.forEach(function (node) { var o = ORIG.get(node); if (o !== undefined && node.nodeValue !== o) { WRITTEN.set(node, o); node.nodeValue = o; } });
    touchedEls.forEach(function (el) {
      var store = ORIG_ATTR.get(el) || {}; var wr = WRITTEN_ATTR.get(el) || {};
      Object.keys(store).forEach(function (attr) { if (el.getAttribute(attr) !== store[attr]) { wr[attr] = store[attr]; el.setAttribute(attr, store[attr]); } });
      WRITTEN_ATTR.set(el, wr);
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
    load(lang).then(function (dict) {
      if (cur() !== lang) return;
      applying = true;
      try { applyText(dict); applyAttrs(dict); legalNotice(lang); dedupeSubtitle(true); } finally { applying = false; }
    });
  }

  // ── 페이지 헬퍼 _papUIL(ko, en) 교체: 사전 → 페이지 자체 표(_PAP_UITR) → en(영어일 때) → ko(옵저버가 나중에 바꾼다)
  function uil(ko, en) {
    var lang = cur();
    if (lang === 'ko' || LANGS.indexOf(lang) === -1) return ko;
    var d = cache[lang];
    if (d) { var t = translate(d, ko); if (t) return t; }
    var tbl = window._PAP_UITR && window._PAP_UITR[ko];
    if (tbl && tbl[lang]) return tbl[lang];
    if (lang === 'en' && en) return en;
    return d ? (en || ko) : ko;
  }
  function installUIL() {
    try { window._papUIL = uil; } catch (_) {}
    try { window._papUiT = function (ko) { var d = cache[cur()]; return (d && translate(d, ko)) || ko; }; } catch (_) {}
  }
  // ── alert / confirm / prompt — DOM 밖 메시지
  function wrapDialogs() {
    ['alert', 'confirm', 'prompt'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function' || orig._papUiI18nWrapped) return;
      var w = function (msg) {
        var args = Array.prototype.slice.call(arguments);
        var lang = cur(); var d = cache[lang];
        if (d && typeof msg === 'string' && HANGUL.test(msg)) {
          // 여러 줄 메시지는 줄마다
          args[0] = msg.split('\n').map(function (line) { return translate(d, line) || line; }).join('\n');
        }
        return orig.apply(window, args);
      };
      w._papUiI18nWrapped = true;
      try { window[name] = w; } catch (_) {}
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
  function isOwnWrite(rec) {
    if (rec.type === 'characterData') return WRITTEN.get(rec.target) === rec.target.nodeValue;
    if (rec.type === 'attributes') { var wr = WRITTEN_ATTR.get(rec.target); return !!wr && wr[rec.attributeName] === rec.target.getAttribute(rec.attributeName); }
    return false;
  }
  function observe() {
    if (mo || !document.documentElement) return;
    mo = new MutationObserver(function (records) {
      if (applying || cur() === 'ko') return;
      var i, real = false;
      for (i = 0; i < records.length; i++) { if (!isOwnWrite(records[i])) { real = true; break; } }
      if (!real) return;
      if (moTimer) return;
      moTimer = setTimeout(function () { moTimer = null; run(); }, 150);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function boot() { installUIL(); wrapDialogs(); wrapSetLang(); setTimeout(wrapSetLang, 0); run(); observe(); }
  installUIL();   // 인라인 스크립트보다 늦게(defer) 실행되므로 지금 덮어써도 된다
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window._papUiI18nApply = run;
  window._papUiI18nTranslate = function (s) { var d = cache[cur()]; return (d && translate(d, s)) || null; };
})();
