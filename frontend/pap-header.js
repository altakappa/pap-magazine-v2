/**
 * PAP Magazine — Unified Shared Header (single source of truth)
 *
 * This file is the ONE place that controls the top navigation bar across
 * every page of the site. When loaded, it:
 *   1. Removes any existing <header class="header">, .nav-overlay,
 *      .pap-search-overlay, .side-nav, .subpage-logo, .auth-btn-sidenav,
 *      .c-header, .mp-back, .mp-lang elements on the page.
 *   2. Injects the canonical header + nav-overlay + search-overlay
 *      (modeled after the home page / index.html header).
 *   3. Provides _papToggleNav / _papToggleSearch / _papToggleAccount
 *      (and aliases toggleNav / toggleSearch / toggleAccountMenu).
 *   4. Wraps setLang() so language-change updates the nav overlay labels.
 *   5. Supports 9 languages: ko / en / it / fr / es / de / ja / zh / ru.
 *
 * To apply this to every page, just include:
 *   <script src="pap-header.js"></script>
 * No per-page HTML is required — any inline <header> on the page will be
 * replaced by this unified header.
 *
 * Opt-out: if a page sets <body data-pap-no-header="1"> the script exits.
 */
(function () {
  'use strict';

  /* ── opt-out hook (rare: only if a page truly wants its own header) ── */
  if (document.body && document.body.getAttribute('data-pap-no-header') === '1') return;

  /* ================================================================
     0. Clean up any pre-existing header / legacy nav markup
     ================================================================ */
  function _removeAll(sel) {
    var nodes = document.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }
  _removeAll('header.header');
  _removeAll('.nav-overlay');
  _removeAll('.pap-search-overlay');
  _removeAll('.side-nav');
  _removeAll('.subpage-logo');
  _removeAll('.auth-btn-sidenav');
  _removeAll('.c-header');
  _removeAll('.mp-back');
  _removeAll('.mp-lang');

  /* ================================================================
     1. CSS — inject only when pap-styles.css is absent
     ================================================================ */
  var hasPapStyles = false;
  var sheets = document.querySelectorAll('link[rel="stylesheet"]');
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].href && sheets[i].href.indexOf('pap-styles.css') !== -1) {
      hasPapStyles = true;
      break;
    }
  }

  if (!hasPapStyles && !document.getElementById('pap-header-css')) {
    var style = document.createElement('style');
    style.id = 'pap-header-css';
    style.textContent = [
      /* header bar */
      '.header{position:fixed;top:0;left:0;right:0;z-index:1000;background:rgba(0,0,0,.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:0 40px;display:flex;align-items:center;justify-content:space-between;height:72px;cursor:default!important}',
      '.header-left{display:flex;align-items:center;gap:24px}',
      '.header-left-item{background:none;border:none;padding:4px;display:inline-flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);text-decoration:none;transition:color .2s}',
      '.header-left-item:hover{color:#fff}',
      '.header-left-item svg{width:20px;height:20px}',
      /* hamburger */
      '.hamburger{background:none;border:none;display:flex;flex-direction:column;gap:6px;padding:12px;cursor:pointer;position:relative;z-index:2000}',
      '.hamburger span{display:block;width:24px;height:2px;background:#fff;transition:transform .3s ease,opacity .3s ease}',
      '.hamburger.is-active span{background:#000}',
      '.hamburger.is-active span:nth-child(1){transform:translateY(8px) rotate(45deg)}',
      '.hamburger.is-active span:nth-child(2){opacity:0}',
      '.hamburger.is-active span:nth-child(3){transform:translateY(-8px) rotate(-45deg)}',
      /* logo */
      '.pap-header-logo{position:absolute;left:50%;transform:translateX(-50%)}',
      '.pap-header-logo img{height:28px;width:auto}',
      /* right side */
      '.header-right{display:flex;align-items:center;gap:6px}',
      '.header-right-item{display:inline-flex;align-items:center;justify-content:center;padding:4px;color:rgba(255,255,255,.4);text-decoration:none;transition:color .2s;background:none;border:none;cursor:pointer;font-family:inherit}',
      '.header-right-item:hover{color:#fff}',
      '.header-right-item svg{width:20px;height:20px}',
      '.lang-btn{display:flex;align-items:center;gap:4px;background:none;border:none;border-radius:0;padding:4px 2px;font-size:11px;font-weight:500;color:#fff}',
      '.lang-btn svg{width:16px;height:16px;opacity:.6}',
      '.lang-btn select{border:none;background:transparent;font-size:11px;font-weight:500;font-family:"Montserrat",sans-serif;color:#fff;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none}',
      '.lang-btn select option{color:#111;background:#fff}',
      '.auth-btn-wrap{position:relative;display:inline-flex}',
      '.account-dropdown{position:absolute;top:calc(100% + 12px);right:0;min-width:180px;background:#111;border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:8px 0;opacity:0;visibility:hidden;transform:translateY(-8px);transition:all .25s cubic-bezier(.25,.46,.45,.94);z-index:2000;box-shadow:0 8px 32px rgba(0,0,0,.5)}',
      '.account-dropdown.active{opacity:1;visibility:visible;transform:translateY(0)}',
      '.account-dropdown a,.account-dropdown button{display:block;width:100%;padding:10px 20px;font-size:11px;font-weight:600;letter-spacing:.1em;color:rgba(255,255,255,.7);text-decoration:none;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;transition:color .2s,background .2s}',
      '.account-dropdown a:hover,.account-dropdown button:hover{color:#fff;background:rgba(255,255,255,.05)}',
      '.account-dropdown .dropdown-divider{height:1px;background:rgba(255,255,255,.08);margin:6px 0}',
      /* search overlay */
      '.pap-search-overlay{position:fixed;inset:0;z-index:1800;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;opacity:0;visibility:hidden;transition:all .3s}',
      '.pap-search-overlay.active{opacity:1;visibility:visible}',
      '.pap-search-overlay .search-close{position:absolute;top:20px;right:24px;background:none;border:none;font-size:28px;color:#fff;cursor:pointer}',
      '.pap-search-overlay .search-inner{width:80%;max-width:600px}',
      '.pap-search-overlay .search-input{width:100%;background:transparent;border:none;border-bottom:2px solid rgba(255,255,255,.3);color:#fff;font-size:24px;font-family:"Montserrat",sans-serif;padding:12px 0;outline:none;letter-spacing:.05em}',
      '.pap-search-overlay .search-input::placeholder{color:rgba(255,255,255,.3)}',
      /* nav overlay */
      '.nav-overlay{position:fixed;inset:0;z-index:1500;background:#fff;opacity:0;visibility:hidden;transition:all .3s}',
      '.nav-overlay.active{opacity:1;visibility:visible}',
      '.nav-overlay-inner{display:flex;width:100%;height:100%;padding:80px 60px 60px}',
      '.nav-left-col{display:flex;flex-direction:column;justify-content:space-between;width:280px;flex-shrink:0}',
      '.nav-left-top{margin-bottom:auto}',
      '.nav-left-top a{font-family:"Montserrat",sans-serif;font-size:clamp(18px,2.5vw,24px);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#000;transition:opacity .2s}',
      '.nav-left-top a:hover{opacity:.4}',
      '.nav-left-links{display:flex;flex-direction:column;gap:4px;margin-bottom:32px}',
      '.nav-left-links a{font-family:"Montserrat",sans-serif;font-size:clamp(18px,2.5vw,24px);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#000;transition:opacity .2s}',
      '.nav-left-links a:hover{opacity:.4}',
      '.nav-bottom-row{display:flex;align-items:center;gap:16px}',
      '.nav-socials{display:flex;flex-direction:row;gap:12px;align-items:center}',
      '.nav-social-icon{display:block;transition:opacity .2s}',
      '.nav-social-icon:hover{opacity:.5}',
      '.nav-right-col{flex:1;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:0}',
      '.nav-right-col a{font-family:"Montserrat",sans-serif;font-size:clamp(40px,7vw,90px);font-weight:900;letter-spacing:.03em;text-transform:uppercase;color:#000;line-height:1.1;transition:opacity .2s}',
      '.nav-right-col a:hover{opacity:.4}',
      '.nav-close{position:absolute;top:20px;left:24px;z-index:1600;background:none;border:none;font-size:0;cursor:pointer;width:36px;height:36px;display:flex;align-items:center;justify-content:center;padding:0}',
      '.nav-close::before,.nav-close::after{content:"";position:absolute;width:22px;height:2px;background:#000;border-radius:1px}',
      '.nav-close::before{transform:rotate(45deg)}',
      '.nav-close::after{transform:rotate(-45deg)}',
      /* responsive */
      '@media(max-width:900px){.nav-extra-links{display:none}.nav-bottom-row{display:none}}',
      '@media(max-width:768px){.header{padding:0 16px;height:60px}.header-left{gap:4px}.header-left-item svg{width:18px;height:18px}.nav-overlay-inner{flex-direction:column;padding:70px 24px 40px}.nav-left-col{width:100%;order:2;margin-top:32px}.nav-right-col{width:100%;align-items:flex-start;order:1}.nav-right-col a{font-size:clamp(28px,8vw,48px)}.nav-left-links a{font-size:clamp(14px,3vw,18px)}}',
      '@media(max-width:480px){.header{padding:0 12px;height:56px}.nav-overlay-inner{padding:60px 20px 32px}.nav-right-col a{font-size:clamp(24px,9vw,36px)}.nav-left-links a{font-size:15px}}',
      '@media(max-width:380px){.header{height:52px;padding:0 8px}.hamburger span{width:20px}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ================================================================
     2. Layout fix — hide legacy elements + push content below header
     ================================================================ */
  if (!document.getElementById('pap-header-layout')) {
    var layoutFix = document.createElement('style');
    layoutFix.id = 'pap-header-layout';
    layoutFix.textContent = [
      /* push content below header on sub-pages */
      '.pap-has-header .content{margin-left:0!important;padding-top:100px!important}',
      '.pap-has-header .footer-legal{margin-left:0!important}',
      /* hide old navigation elements */
      '.pap-has-header .side-nav{display:none!important}',
      '.pap-has-header .subpage-logo{display:none!important}',
      '.pap-has-header .auth-btn-sidenav{display:none!important}',
      '.pap-has-header > .lang-selector{display:none!important}',
      '.pap-has-header .c-header{display:none!important}',
      '.pap-has-header .mp-back{display:none!important}',
      '.pap-has-header .mp-lang{display:none!important}',
      /* community: push body below header */
      '.pap-has-header .c-body{padding-top:72px!important}',
      /* mypage: adjust wrapper */
      '.pap-has-header .mp-wrapper{padding-top:100px!important}',
      /* sub-pages mobile */
      '@media(max-width:768px){.pap-has-header .content{padding-top:80px!important;padding-left:20px!important;padding-right:20px!important}.pap-has-header .footer-legal{padding-left:20px!important;padding-right:20px!important}}',
    ].join('\n');
    document.head.appendChild(layoutFix);
  }
  if (document.body) document.body.classList.add('pap-has-header');

  /* ================================================================
     3. HTML — build and inject
     ================================================================ */

  /* Social icons SVG (same as index.html) */
  var socialHTML = [
    '<a href="https://www.youtube.com/@pap-magazine" target="_blank" class="nav-social-icon" aria-label="YouTube"><svg viewBox="0 0 40 40" width="36" height="36"><rect x="2" y="6" width="36" height="28" rx="8" fill="#FF0000"/><polygon points="16,12 16,28 28,20" fill="#fff"/></svg></a>',
    '<a href="https://www.facebook.com/papmagazine/" target="_blank" class="nav-social-icon" aria-label="Facebook"><svg viewBox="0 0 40 40" width="36" height="36"><rect x="4" y="4" width="32" height="32" rx="8" fill="#1877F2"/><path d="M26.5 21l.8-5h-4.8v-3.2c0-1.4.7-2.8 2.9-2.8h2.2V5.6s-2-.3-3.9-.3c-4 0-6.6 2.4-6.6 6.8V16H13v5h4.1v12h5.1V21h3.3z" fill="#fff"/></svg></a>',
    '<a href="https://www.instagram.com/pap_magazine/" target="_blank" class="nav-social-icon" aria-label="Instagram"><svg viewBox="0 0 40 40" width="36" height="36"><defs><linearGradient id="igH" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#FFC107"/><stop offset="25%" stop-color="#F44336"/><stop offset="50%" stop-color="#E040FB"/><stop offset="75%" stop-color="#9C27B0"/><stop offset="100%" stop-color="#5B51D8"/></linearGradient></defs><rect x="4" y="4" width="32" height="32" rx="9" fill="url(#igH)"/><rect x="8" y="8" width="24" height="24" rx="6" fill="none" stroke="#fff" stroke-width="2"/><circle cx="20" cy="20" r="5.5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="28" cy="12" r="1.8" fill="#fff"/></svg></a>',
    '<a href="https://www.threads.net/@pap_magazine" target="_blank" class="nav-social-icon" aria-label="Threads"><svg viewBox="0 0 40 40" width="36" height="36"><rect x="4" y="4" width="32" height="32" rx="9" fill="#000"/><path d="M25.5 19.2c-.1-.6-.4-1.1-.8-1.6-.8-1-1.9-1.6-3.2-1.7-1.5-.2-2.8.3-3.8 1.3-.8.9-1.2 1.9-1.2 3.1 0 1.3.5 2.4 1.4 3.2.9.8 2 1.1 3.2 1 1-.1 1.9-.5 2.6-1.2.5-.6.8-1.3.8-2.1 0-.7-.2-1.3-.7-1.8-.5-.5-1.2-.7-1.9-.6-.6.1-1.1.3-1.4.8-.3.4-.4 1-.2 1.5.2.4.5.8.9 1" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg></a>',
    '<a href="https://www.tiktok.com/@pap_mag" target="_blank" class="nav-social-icon" aria-label="TikTok"><svg viewBox="0 0 40 40" width="36" height="36"><rect x="4" y="4" width="32" height="32" rx="9" fill="#010101"/><path d="M27.3 16.5c-1.3-.9-2.2-2.3-2.3-4h-3v11.8a2.7 2.7 0 1 1-1.8-2.5v-3.1a5.7 5.7 0 1 0 4.8 5.6V18.6c1.1.8 2.5 1.2 3.9 1.2v-3c-.6 0-1.1-.1-1.6-.3z" fill="#25F4EE" transform="translate(-0.7,-0.5)"/><path d="M27.3 16.5c-1.3-.9-2.2-2.3-2.3-4h-3v11.8a2.7 2.7 0 1 1-1.8-2.5v-3.1a5.7 5.7 0 1 0 4.8 5.6V18.6c1.1.8 2.5 1.2 3.9 1.2v-3c-.6 0-1.1-.1-1.6-.3z" fill="#FE2C55" transform="translate(0.7,0.5)"/><path d="M27.3 16.5c-1.3-.9-2.2-2.3-2.3-4h-3v11.8a2.7 2.7 0 1 1-1.8-2.5v-3.1a5.7 5.7 0 1 0 4.8 5.6V18.6c1.1.8 2.5 1.2 3.9 1.2v-3c-.6 0-1.1-.1-1.6-.3z" fill="#fff"/></svg></a>'
  ].join('');

  /* Language options — 9 languages incl. German */
  var langOptions =
    '<option value="ko">한국어</option>' +
    '<option value="en">English</option>' +
    '<option value="it">Italiano</option>' +
    '<option value="fr">Français</option>' +
    '<option value="es">Español</option>' +
    '<option value="de">Deutsch</option>' +
    '<option value="ja">日本語</option>' +
    '<option value="zh">中文</option>' +
    '<option value="ru">Русский</option>';

  /* Sub-pages: direct navigation (no interstitial ads) */
  function _navDirect(url) {
    return 'event.preventDefault();_papCloseNav();window.location.href=\'' + url + '\';';
  }
  /* Main content pages: use navigateWithInterstitial if available */
  function _navGo(url) {
    return 'event.preventDefault();_papCloseNav();' +
      '(typeof window.navigateWithInterstitial===\'function\'' +
      '?navigateWithInterstitial(\'' + url + '\')' +
      ':(window.location.href=\'' + url + '\'));';
  }

  var headerHTML = [
    /* Search overlay */
    '<div class="pap-search-overlay" id="papSearchOverlay">',
    '  <button class="search-close" onclick="_papToggleSearch()">&times;</button>',
    '  <div class="search-inner"><input class="search-input" type="text" id="papSearchInput" placeholder="Search..."></div>',
    '</div>',
    /* Nav overlay */
    '<div class="nav-overlay" id="navOverlay">',
    '  <button class="nav-close" onclick="_papToggleNav()">&times;</button>',
    '  <div class="nav-overlay-inner">',
    '    <div class="nav-left-col">',
    '      <div class="nav-left-top">',
    '        <a href="#" onclick="' + _navDirect('subscribe.html') + '" data-i18n="subscribe">SUBSCRIBE</a>',
    '      </div>',
    '      <div class="nav-left-links">',
    '        <a href="#" onclick="' + _navDirect('submission.html') + '" data-i18n="submission">SUBMISSION</a>',
    '        <a href="#" onclick="' + _navDirect('pullletter.html') + '" data-i18n="pullletter">PULL-LETTER</a>',
    '        <a href="auth.html" data-i18n="navLogin" style="color:rgba(255,255,255,.6)">LOGIN / JOIN</a>',
    '      </div>',
    '      <div class="nav-left-links nav-extra-links" style="margin-top:auto">',
    '        <a href="#" onclick="' + _navDirect('about.html') + '" data-i18n="about">ABOUT</a>',
    '        <a href="#" onclick="' + _navDirect('business.html') + '" data-i18n="business">BUSINESS</a>',
    '        <a href="#" onclick="' + _navDirect('contact.html') + '" data-i18n="contact">CONTACT</a>',
    '      </div>',
    '      <div class="nav-bottom-row">',
    '        <div class="nav-socials active" id="navSocials">' + socialHTML + '</div>',
    '      </div>',
    '    </div>',
    '    <div class="nav-right-col">',
    '      <a href="#" onclick="' + _navGo('community.html') + '" data-i18n="navCommunity" style="color:#891717">COMMUNITY</a>',
    '      <a href="#" onclick="' + _navGo('magazine.html') + '" data-i18n="navMagazine" style="color:#c9a96e">MAGAZINE</a>',
    '      <a href="index.html" onclick="event.preventDefault();_papCloseNav();window.location.href=\'index.html\';" data-i18n="navEditorial">EDITORIAL</a>',
    '      <a href="#" onclick="' + _navGo('articles.html') + '" data-i18n="navArticle">ARTICLE</a>',
    '      <a href="#" onclick="' + _navGo('films.html') + '" data-i18n="navFilm">FILM</a>',
    '    </div>',
    '  </div>',
    '</div>',
    /* Header bar */
    '<header class="header">',
    '  <div class="header-left">',
    '    <button class="hamburger" onclick="_papToggleNav()" aria-label="Menu"><span></span><span></span><span></span></button>',
    '    <button class="search-btn header-left-item" onclick="_papToggleSearch()" aria-label="Search">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    '    </button>',
    '  </div>',
    '  <a href="/" class="pap-header-logo"><img src="pap-logo.png" alt="PAP Magazine"></a>',
    '  <div class="header-right">',
    '    <div class="lang-btn">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></svg>',
    '      <select id="langSelect" onchange="setLang(this.value)">' + langOptions + '</select>',
    '    </div>',
    '    <div class="auth-btn-wrap">',
    '      <button class="header-right-item" onclick="_papToggleAccount(event)" aria-label="Account">',
    '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    '      </button>',
    '      <div class="account-dropdown" id="accountDropdown">',
    '        <a href="auth.html" data-i18n="navLogin">로그인 / 회원가입</a>',
    '        <div class="dropdown-divider"></div>',
    '        <a href="subscribe.html" data-i18n="subscribe">구독하기</a>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</header>'
  ].join('\n');

  /* Inject into body (first child) — runs regardless of whether DOM is fully parsed */
  function _injectHeader() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', _injectHeader);
      return;
    }
    /* Clean-up again in case inline markup was added late */
    _removeAll('header.header');
    _removeAll('.nav-overlay');
    _removeAll('.pap-search-overlay');

    var wrapper = document.createElement('div');
    wrapper.innerHTML = headerHTML;
    var frag = document.createDocumentFragment();
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
    document.body.insertBefore(frag, document.body.firstChild);

    _afterInject();
  }
  _injectHeader();

  function _afterInject() {
    /* ================================================================
       4. JS — provide nav / search / account functions
       ================================================================ */

    /* Scroll lock (reuse if already defined by interstitial script) */
    if (typeof window._scrollLockCount === 'undefined') {
      window._scrollLockCount = 0;
      window._savedScrollY = 0;
    }
    if (typeof window.lockScroll !== 'function') {
      window.lockScroll = function () {
        if (window._scrollLockCount === 0) {
          window._savedScrollY = window.scrollY;
          document.body.style.position = 'fixed';
          document.body.style.top = '-' + window._savedScrollY + 'px';
          document.body.style.left = '0';
          document.body.style.right = '0';
        }
        window._scrollLockCount++;
      };
    }
    if (typeof window.unlockScroll !== 'function') {
      window.unlockScroll = function () {
        window._scrollLockCount--;
        if (window._scrollLockCount <= 0) {
          window._scrollLockCount = 0;
          document.body.style.position = '';
          document.body.style.top = '';
          document.body.style.left = '';
          document.body.style.right = '';
          window.scrollTo(0, window._savedScrollY);
        }
      };
    }

    /* Toggle Nav */
    window._papToggleNav = function () {
      var n = document.getElementById('navOverlay');
      if (!n) return;
      var opening = !n.classList.contains('active');
      n.classList.toggle('active');
      var hb = document.querySelector('.hamburger');
      if (hb) {
        if (opening) hb.classList.add('is-active');
        else hb.classList.remove('is-active');
      }
      if (opening) lockScroll();
      else unlockScroll();
    };
    window._papCloseNav = function () {
      var n = document.getElementById('navOverlay');
      if (n && n.classList.contains('active')) _papToggleNav();
    };

    /* Alias for pages that call toggleNav() / closeNav() — OVERRIDE stale definitions from inline pages */
    window.toggleNav = window._papToggleNav;
    window.closeNav = window._papCloseNav;

    /* Toggle Search */
    window._papToggleSearch = function () {
      var o = document.getElementById('papSearchOverlay');
      if (!o) return;
      o.classList.toggle('active');
      if (o.classList.contains('active')) {
        lockScroll();
        setTimeout(function () {
          var inp = document.getElementById('papSearchInput');
          if (inp) inp.focus();
        }, 300);
      } else {
        unlockScroll();
      }
    };
    window.toggleSearch = window._papToggleSearch;

    /* Toggle Account dropdown */
    function _closeAcctH(e) {
      var d = document.getElementById('accountDropdown');
      if (d && !d.contains(e.target)) {
        d.classList.remove('active');
        document.removeEventListener('click', _closeAcctH);
      }
    }
    window._papToggleAccount = function (e) {
      if (e) e.stopPropagation();
      var d = document.getElementById('accountDropdown');
      if (!d) return;
      d.classList.toggle('active');
      if (d.classList.contains('active')) {
        setTimeout(function () { document.addEventListener('click', _closeAcctH); }, 10);
      } else {
        document.removeEventListener('click', _closeAcctH);
      }
    };
    window.toggleAccountMenu = window._papToggleAccount;

    /* Escape key */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var sOv = document.getElementById('papSearchOverlay');
        if (sOv && sOv.classList.contains('active')) { _papToggleSearch(); return; }
        _papCloseNav();
        var ad = document.getElementById('accountDropdown');
        if (ad) ad.classList.remove('active');
      }
    });

    /* ================================================================
       5. Sync language selector with page state (9 languages)
       ================================================================ */
    var saved = localStorage.getItem('pap-lang') || 'ko';
    var sel = document.getElementById('langSelect');
    if (sel) sel.value = saved;

    /* Apply i18n to injected header elements */
    var _hdrT = {
      ko: { subscribe: '구독하기', submission: '서브미션', pullletter: '풀레터', navLogin: '로그인 / 회원가입', about: 'ABOUT', business: 'BUSINESS', contact: 'CONTACT', navCommunity: '커뮤니티', navMagazine: '매거진', navEditorial: '에디토리얼', navArticle: '아티클', navFilm: '필름' },
      en: { subscribe: 'SUBSCRIBE', submission: 'SUBMISSION', pullletter: 'PULL-LETTER', navLogin: 'LOGIN / JOIN', about: 'ABOUT', business: 'BUSINESS', contact: 'CONTACT', navCommunity: 'COMMUNITY', navMagazine: 'MAGAZINE', navEditorial: 'EDITORIAL', navArticle: 'ARTICLE', navFilm: 'FILM' },
      it: { subscribe: 'ABBONATI', submission: 'SUBMISSION', pullletter: 'PULL-LETTER', navLogin: 'ACCEDI / ISCRIVITI', about: 'CHI SIAMO', business: 'BUSINESS', contact: 'CONTATTI', navCommunity: 'COMMUNITY', navMagazine: 'MAGAZINE', navEditorial: 'EDITORIALE', navArticle: 'ARTICOLO', navFilm: 'FILM' },
      fr: { subscribe: "S'ABONNER", submission: 'SOUMISSION', pullletter: 'PULL-LETTER', navLogin: 'CONNEXION / INSCRIPTION', about: 'À PROPOS', business: 'BUSINESS', contact: 'CONTACT', navCommunity: 'COMMUNAUTÉ', navMagazine: 'MAGAZINE', navEditorial: 'ÉDITORIAL', navArticle: 'ARTICLE', navFilm: 'FILM' },
      es: { subscribe: 'SUSCRIBIRSE', submission: 'ENVÍO', pullletter: 'PULL-LETTER', navLogin: 'INICIAR SESIÓN / UNIRSE', about: 'ACERCA DE', business: 'NEGOCIOS', contact: 'CONTACTO', navCommunity: 'COMUNIDAD', navMagazine: 'REVISTA', navEditorial: 'EDITORIAL', navArticle: 'ARTÍCULO', navFilm: 'FILM' },
      de: { subscribe: 'ABONNIEREN', submission: 'EINREICHUNG', pullletter: 'PULL-LETTER', navLogin: 'ANMELDEN / REGISTRIEREN', about: 'ÜBER UNS', business: 'BUSINESS', contact: 'KONTAKT', navCommunity: 'COMMUNITY', navMagazine: 'MAGAZIN', navEditorial: 'EDITORIAL', navArticle: 'ARTIKEL', navFilm: 'FILM' },
      ja: { subscribe: '購読', submission: 'サブミッション', pullletter: 'PULL-LETTER', navLogin: 'ログイン / 会員登録', about: 'アバウト', business: 'ビジネス', contact: 'お問い合わせ', navCommunity: 'コミュニティ', navMagazine: 'マガジン', navEditorial: 'エディトリアル', navArticle: 'アーティクル', navFilm: 'フィルム' },
      zh: { subscribe: '订阅', submission: '投稿', pullletter: 'PULL-LETTER', navLogin: '登录 / 注册', about: '关于我们', business: '商务合作', contact: '联系方式', navCommunity: '社区', navMagazine: '杂志', navEditorial: '编辑精选', navArticle: '文章', navFilm: '影片' },
      ru: { subscribe: 'ПОДПИСАТЬСЯ', submission: 'ОТПРАВИТЬ', pullletter: 'PULL-LETTER', navLogin: 'ВХОД / РЕГИСТРАЦИЯ', about: 'О НАС', business: 'БИЗНЕС', contact: 'КОНТАКТЫ', navCommunity: 'СООБЩЕСТВО', navMagazine: 'ЖУРНАЛ', navEditorial: 'РЕДАКЦИЯ', navArticle: 'СТАТЬЯ', navFilm: 'ФИЛЬМ' }
    };
    window._papApplyHeaderI18n = function (lang) {
      var s = _hdrT[lang] || _hdrT.en;
      /* Only touch elements inside the injected header/overlay */
      var scopes = [
        document.querySelector('header.header'),
        document.getElementById('navOverlay'),
        document.getElementById('accountDropdown')
      ];
      scopes.forEach(function (scope) {
        if (!scope) return;
        scope.querySelectorAll('[data-i18n]').forEach(function (el) {
          var k = el.getAttribute('data-i18n');
          if (s[k]) el.textContent = s[k];
        });
      });
    };
    window._papApplyHeaderI18n(saved);

    /* Wrap existing setLang so header updates on language change */
    var _origSetLang = typeof window.setLang === 'function' ? window.setLang : null;
    window.setLang = function (l) {
      if (_origSetLang && _origSetLang !== window.setLang) _origSetLang(l);
      else localStorage.setItem('pap-lang', l);
      window._papApplyHeaderI18n(l);
      var sl = document.getElementById('langSelect');
      if (sl) sl.value = l;
    };

    /* Update login links based on user state */
    function _updateAuthDropdown() {
      if (typeof window._papUpdateAuthDropdown === 'function') {
        try { window._papUpdateAuthDropdown(); return; } catch (e) { }
      }
      try {
        var u = localStorage.getItem('pap-user');
        var token = localStorage.getItem('pap-token');
        if (u || token) {
          var dd = document.getElementById('accountDropdown');
          if (dd) {
            var lang = localStorage.getItem('pap-lang') || 'ko';
            var t = {
              ko: { home: '홈으로', subscribe: '구독 관리', logout: '로그아웃' },
              en: { home: 'HOME', subscribe: 'MANAGE SUBSCRIPTION', logout: 'LOG OUT' },
              it: { home: 'HOME', subscribe: 'GESTISCI ABBONAMENTO', logout: 'ESCI' },
              fr: { home: 'ACCUEIL', subscribe: "GÉRER L'ABONNEMENT", logout: 'DÉCONNEXION' },
              es: { home: 'INICIO', subscribe: 'GESTIONAR SUSCRIPCIÓN', logout: 'CERRAR SESIÓN' },
              de: { home: 'STARTSEITE', subscribe: 'ABO VERWALTEN', logout: 'ABMELDEN' },
              ja: { home: 'ホームへ', subscribe: '購読管理', logout: 'ログアウト' },
              zh: { home: '首页', subscribe: '管理订阅', logout: '退出登录' },
              ru: { home: 'ГЛАВНАЯ', subscribe: 'УПРАВЛЕНИЕ ПОДПИСКОЙ', logout: 'ВЫЙТИ' }
            };
            var s = t[lang] || t.en;
            dd.innerHTML =
              '<a href="/">' + s.home + '</a>' +
              '<a href="subscribe.html">' + s.subscribe + '</a>' +
              '<div class="dropdown-divider"></div>' +
              '<button onclick="localStorage.removeItem(\'pap-token\');localStorage.removeItem(\'pap-user\');window.location.href=\'/\';">' + s.logout + '</button>';
          }
        }
      } catch (e) { }
    }
    _updateAuthDropdown();
  }

})();
