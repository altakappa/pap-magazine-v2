/**
 * PAP Magazine — Unified Shared Header (single source of truth)
 *
 * This file is the ONE place that controls the top navigation bar across
 * every page of the site. When loaded, it:
 *   1. Removes duplicate MAIN-nav elements only: <header class="header">,
 *      .nav-overlay, .pap-search-overlay. It does NOT touch page-specific
 *      sub-navigation (e.g. community's .c-header with FEED/PROJECTS/AI
 *      MATCH/DIRECTORY/MOODBOARD tabs, mypage's .mp-back/.mp-lang, etc.).
 *      Legacy .side-nav / .subpage-logo / .auth-btn-sidenav are hidden
 *      via CSS (display:none) instead of removed — safer for pages that
 *      reference them in their own JS.
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

  /* Index.html has a .floating-logo element whose animation JS (in pap-app.js)
     captures a live reference to the original <header>'s .logo-wrap via
     getBoundingClientRect(). If we remove and re-inject the header on that
     page, the captured reference becomes stale and the floating logo docks
     at 0,0 (top-left). Since index.html already has the canonical inline
     header design we want to unify everyone around, we simply exit early
     on pages that host the floating logo. All OTHER pages still get the
     unified header. */
  if (document.querySelector('.floating-logo')) return;

  /* ================================================================
     0. Clean up any pre-existing header / legacy nav markup
     ================================================================ */
  function _removeAll(sel) {
    var nodes = document.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }
  /* Remove ONLY duplicate main-nav elements. Page-specific sub-headers
     (e.g. community's .c-header with its tabs, mypage's .mp-back/.mp-lang)
     are preserved — they hold functionality the page depends on. Legacy
     .side-nav / .subpage-logo / .auth-btn-sidenav are hidden via CSS
     below, not removed, to avoid breaking inline scripts that reference
     them by id/class. */
  _removeAll('header.header');
  _removeAll('header.auth-header');
  _removeAll('.nav-overlay');
  _removeAll('.pap-search-overlay');
  /* Remove ORPHAN language selectors that live outside the header (e.g.
     legacy `.lang-selector` in business/contact/about/submission/pullletter,
     `.mp-lang` in mypage). They each contain a stray `<select id="langSelect">`
     which creates duplicate IDs in DOM once the unified header is injected. */
  _removeAll('body > .lang-selector');
  _removeAll('.mp-lang');
  _removeAll('.mp-back');

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
      /* header bar
         z-index 1600 — must out-stack .nav-overlay (1500) so the
         hamburger inside the header stays clickable while the menu is
         open. The hamburger's own z-index:2000 cannot escape this
         header's stacking context (position:fixed creates one), so the
         header layer itself has to win the battle against the overlay. */
      '.header{position:fixed;top:0;left:0;right:0;z-index:1600;background:rgba(0,0,0,.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:0 40px;display:flex;align-items:center;justify-content:space-between;height:72px;cursor:default!important}',
      /* While the menu is open, blank the dark backdrop so the white
         nav-overlay reads cleanly behind the X button — without this
         the 72px dark band keeps sitting on top of the white menu and
         feels broken. The X bars below use .hamburger.is-active span
         {background:#000} so they stay visible against the white. */
      '.nav-overlay.active ~ .header,body:has(.nav-overlay.active) .header{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none}',
      '.header-left{display:flex;align-items:center;gap:24px}',
      '.header-left-item{background:none;border:none;padding:4px;display:inline-flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);text-decoration:none;transition:color .2s}',
      '.header-left-item:hover{color:#fff}',
      '.header-left-item svg{width:20px;height:20px}',
      /* hamburger — single morphing button (≡ ↔ X). Stays at z-index:2000
         so it floats above the nav-overlay (z-index:1500) and acts as the
         close button itself when the menu is open. No separate ".nav-close"
         button is rendered anymore — the bars below morph in place. */
      '.hamburger{background:none;border:none;display:flex;flex-direction:column;gap:6px;padding:12px;cursor:pointer;position:relative;z-index:2000;-webkit-tap-highlight-color:transparent}',
      // The 3 bars share one transition so transform + colour move together
      // on the same timing curve. cubic-bezier(.65,.05,.36,1) is the same
      // ease used on the nav-overlay fade so the whole interaction feels
      // like one motion.
      '.hamburger span{display:block;width:24px;height:2px;background:#fff;border-radius:1px;transform-origin:center;transition:transform .35s cubic-bezier(.65,.05,.36,1),opacity .25s ease,background-color .35s cubic-bezier(.65,.05,.36,1)}',
      '.hamburger.is-active span{background:#000}',
      '.hamburger.is-active span:nth-child(1){transform:translateY(8px) rotate(45deg)}',
      '.hamburger.is-active span:nth-child(2){opacity:0;transform:scaleX(.6)}',
      '.hamburger.is-active span:nth-child(3){transform:translateY(-8px) rotate(-45deg)}',
      /* logo — match pap-styles.css .logo-wrap */
      '.logo-wrap{position:absolute;left:50%;transform:translateX(-50%)}',
      '.logo-wrap img{height:32px;width:auto}',
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
      // .pap-nav-close style is appended below via the always-injected
      // "pap-nav-close-css" tag so it applies regardless of whether
      // pap-styles.css is loaded.
      /* responsive
         Earlier this hid .nav-extra-links (ABOUT/BUSINESS/CONTACT) and
         .nav-bottom-row (socials) below 900px — leftover from a wider
         tablet design. The mobile nav-overlay has plenty of vertical
         space, so we keep everything visible and just rescale typography
         to fit. */
      '@media(max-width:900px){',
      '  .nav-extra-links{display:flex!important}',
      '  .nav-bottom-row{display:flex!important}',
      '}',
      '@media(max-width:768px){',
      '  .header{padding:0 16px;height:60px}',
      '  .header-left{gap:4px}',
      '  .header-left-item svg{width:18px;height:18px}',
      '  /* Stack nav columns: right (big titles) on top, left (links + socials) below. Both full width with consistent left-aligned typography. */',
      '  .nav-overlay-inner{flex-direction:column;padding:70px 24px 32px;overflow-y:auto;-webkit-overflow-scrolling:touch}',
      '  .nav-right-col{width:100%;align-items:flex-start;order:1;gap:8px;justify-content:flex-start;padding-bottom:24px;border-bottom:1px solid rgba(0,0,0,.08)}',
      '  .nav-right-col a{font-size:clamp(28px,8vw,48px)}',
      '  .nav-left-col{width:100%;order:2;margin-top:24px}',
      '  .nav-left-top{margin-bottom:16px}',
      /* Unified primary-nav sizing — SUBSCRIBE / SUBMISSION / PULL-LETTER /
         LOGIN-JOIN all share the same scale on mobile so the column reads
         as one consistent block. Earlier the nav-left-top entry stayed at
         18px while the others dropped to 15px which looked uneven. */
      '  .nav-left-top a{font-size:clamp(14px,3vw,18px)}',
      '  .nav-left-links{margin-bottom:20px;gap:6px}',
      '  .nav-left-links a{font-size:clamp(14px,3vw,18px)}',
      '  .nav-extra-links{margin-top:0!important}',
      '  .nav-bottom-row{margin-top:8px;padding-top:20px;border-top:1px solid rgba(0,0,0,.08)}',
      '  .nav-socials{flex-wrap:wrap;gap:14px}',
      '  .nav-social-icon svg{width:32px;height:32px}',
      '}',
      '@media(max-width:480px){',
      '  .header{padding:0 12px;height:56px}',
      '  .nav-overlay-inner{padding:60px 20px 28px}',
      '  .nav-right-col a{font-size:clamp(24px,9vw,36px)}',
      '  .nav-left-top a{font-size:15px}',
      '  .nav-left-links a{font-size:15px}',
      '  .nav-social-icon svg{width:28px;height:28px}',
      '}',
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
      '.pap-has-header:not(.pap-keep-side-nav) .content{margin-left:0!important;padding-top:100px!important}',
      '.pap-has-header:not(.pap-keep-side-nav) .footer-legal{margin-left:0!important}',
      /* pages that opt-in to keep the legacy .side-nav coexist with unified header */
      '.pap-has-header.pap-keep-side-nav .content{padding-top:100px!important}',
      '.pap-has-header.pap-keep-side-nav .footer-legal{padding-top:0!important}',
      '.pap-has-header.pap-keep-side-nav .side-nav{top:72px!important;padding-top:20px!important;height:calc(100vh - 72px)!important}',
      '.pap-has-header.pap-keep-side-nav .side-nav .nav-dots{display:none!important}',
      '@media(max-width:768px){.pap-has-header.pap-keep-side-nav .side-nav{top:60px!important;height:calc(100vh - 60px)!important;padding-top:12px!important}.pap-has-header.pap-keep-side-nav .content{padding-top:80px!important}}',
      '@media(max-width:480px){.pap-has-header.pap-keep-side-nav .side-nav{top:56px!important;height:calc(100vh - 56px)!important}}',
      /* hide legacy duplicate navigation elements (NOT the page's own sub-header) */
      '.pap-has-header:not(.pap-keep-side-nav) .side-nav{display:none!important}',
      '.pap-has-header .subpage-logo{display:none!important}',
      '.pap-has-header .auth-btn-sidenav{display:none!important}',
      '.pap-has-header > .lang-selector{display:none!important}',
      /* mypage: hide its legacy mini top-bar (unified header covers it) */
      '.pap-has-header .mp-back{display:none!important}',
      '.pap-has-header .mp-lang{display:none!important}',
      /* community: KEEP .c-header visible (tab navigation) and position it
         immediately below the 72px unified header. Body padding = 72+44. */
      '.pap-has-header .c-header{top:72px!important;z-index:999!important}',
      '.pap-has-header .c-body{padding-top:116px!important}',
      /* mypage: adjust wrapper */
      '.pap-has-header .mp-wrapper{padding-top:100px!important}',
      /* auth page: adjust wrapper */
      '.pap-has-header .auth-wrapper{padding-top:100px!important}',
      /* sub-pages mobile */
      '@media(max-width:768px){.pap-has-header:not(.pap-keep-side-nav) .content{padding-top:80px!important;padding-left:20px!important;padding-right:20px!important}.pap-has-header:not(.pap-keep-side-nav) .footer-legal{padding-left:20px!important;padding-right:20px!important}.pap-has-header .c-header{top:60px!important}.pap-has-header .c-body{padding-top:104px!important}}',
      '@media(max-width:480px){.pap-has-header .c-header{top:56px!important}.pap-has-header .c-body{padding-top:100px!important}}',
    ].join('\n');
    document.head.appendChild(layoutFix);
  }
  if (document.body) document.body.classList.add('pap-has-header');

  /* Safety net: ALWAYS clamp header logo + header sizing, even if
     pap-styles.css is loaded. Prevents the logo rendering at its
     native pixel size when a page's CSS is missing the rule. */
  if (!document.getElementById('pap-header-safety')) {
    var safety = document.createElement('style');
    safety.id = 'pap-header-safety';
    safety.textContent = [
      'header.header{position:fixed!important;top:0;left:0;right:0;z-index:1000;height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 40px;background:rgba(0,0,0,.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
      'header.header .logo-wrap{position:absolute!important;left:50%;top:50%;transform:translate(-50%,-50%);margin:0;padding:0;max-height:40px;overflow:hidden;display:inline-flex;align-items:center}',
      'header.header .logo-wrap img{height:32px!important;width:auto!important;max-height:32px!important;display:block}',
      '@media(max-width:768px){header.header{height:60px;padding:0 16px}header.header .logo-wrap img{height:24px!important;max-height:24px!important}}',
      '@media(max-width:480px){header.header{height:56px;padding:0 12px}header.header .logo-wrap img{height:20px!important;max-height:20px!important}}'
    ].join('\n');
    document.head.appendChild(safety);
  }

  /* Safety net: ALWAYS inject .pap-nav-close CSS — this is the dedicated
     X close button injected into .nav-overlay by this script. It's a new
     class owned by pap-header.js, NOT defined in pap-styles.css, so it
     must always be injected. Sits at top-left of the white nav-overlay
     and is the user-visible "close" affordance — the hamburger also
     morphs into an X via .is-active, but pages whose CSS fails to
     recolour the bars (QA #147 — subscribe page bars stayed white on
     white) still got no visible close; this guarantees one. */
  if (!document.getElementById('pap-nav-close-css')) {
    var navCloseCss = document.createElement('style');
    navCloseCss.id = 'pap-nav-close-css';
    navCloseCss.textContent = [
      /* Default state: hidden. The nav-overlay sits z-index:1500, the
         hamburger 2000 — slot this X between (1700) so it floats above
         the white menu but stays out of the hamburger's way. */
      '.pap-nav-close{position:fixed!important;top:18px;left:18px;z-index:1700;width:44px;height:44px;display:none;align-items:center;justify-content:center;background:none;border:none;padding:0;cursor:pointer;color:#000;-webkit-tap-highlight-color:transparent;font-family:inherit}',
      /* Reveal whenever the nav-overlay is open. Two selectors cover both
         the "X is sibling of .nav-overlay" case AND the "X is INSIDE
         .nav-overlay" case (this script injects it as a child). */
      '.nav-overlay.active .pap-nav-close,body:has(.nav-overlay.active) .pap-nav-close{display:flex}',
      '.pap-nav-close:hover{opacity:.6}',
      '.pap-nav-close svg{display:block;width:22px;height:22px;stroke:#000}',
      /* Compact spacing on phones to match the smaller header. */
      '@media(max-width:768px){.pap-nav-close{top:12px;left:12px;width:40px;height:40px}}',
      '@media(max-width:480px){.pap-nav-close{top:10px;left:10px;width:36px;height:36px}}'
    ].join('\n');
    document.head.appendChild(navCloseCss);
  }

  /* Safety net: ALWAYS inject .pap-search-overlay CSS — it's a class
     introduced by this script and is NOT defined in pap-styles.css, so
     without these rules the overlay would render as a flowing block and
     the "Search..." input would show at the top of the page. */
  if (!document.getElementById('pap-search-overlay-css')) {
    var searchCss = document.createElement('style');
    searchCss.id = 'pap-search-overlay-css';
    searchCss.textContent = [
      '.pap-search-overlay{position:fixed!important;inset:0;z-index:1800;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;opacity:0;visibility:hidden;transition:all .3s}',
      '.pap-search-overlay.active{opacity:1;visibility:visible}',
      '.pap-search-overlay .search-close{position:absolute;top:20px;right:24px;background:none;border:none;font-size:28px;color:#fff;cursor:pointer}',
      '.pap-search-overlay .search-inner{width:80%;max-width:600px}',
      '.pap-search-overlay .search-input{width:100%;background:transparent;border:none;border-bottom:2px solid rgba(255,255,255,.3);color:#fff;font-size:24px;font-family:"Montserrat",sans-serif;padding:12px 0;outline:none;letter-spacing:.05em}',
      '.pap-search-overlay .search-input::placeholder{color:rgba(255,255,255,.3)}'
    ].join('\n');
    document.head.appendChild(searchCss);
  }

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
    // Dedicated close button at top-left. The .hamburger ALSO morphs into
    // an X via .is-active, but this explicit .nav-close acts as a safety
    // net for pages where the hamburger-morph CSS fails to apply (which
    // QA #147 caught on subscribe / other sub-pages: bars stayed white
    // on the white overlay, so the user reported "no close button").
    '  <button class="pap-nav-close" onclick="_papCloseNav()" aria-label="Close menu" type="button">',
    '    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>',
    '  </button>',
    '  <div class="nav-overlay-inner">',
    '    <div class="nav-left-col">',
    '      <div class="nav-left-top">',
    '        <a href="#" onclick="' + _navDirect('/subscribe') + '" data-i18n="subscribe">SUBSCRIBE</a>',
    '      </div>',
    '      <div class="nav-left-links">',
    '        <a href="#" onclick="' + _navDirect('/submission') + '" data-i18n="submission">SUBMISSION</a>',
    '        <a href="#" onclick="' + _navDirect('/pullletter') + '" data-i18n="pullletter">PULL-LETTER</a>',
    '        <a href="/auth" data-i18n="navLogin" style="color:rgba(255,255,255,.6)">LOGIN / JOIN</a>',
    '      </div>',
    '      <div class="nav-left-links nav-extra-links" style="margin-top:auto">',
    // QA #325 — 클린 URL 정책: /about /business /contact (vercel.json 의
    // rewrite 가 서빙, .html 직접 접근은 301 redirect 로 수렴).
    '        <a href="#" onclick="' + _navDirect('/about') + '" data-i18n="about">ABOUT</a>',
    '        <a href="#" onclick="' + _navDirect('/business') + '" data-i18n="business">BUSINESS</a>',
    '        <a href="#" onclick="' + _navDirect('/contact') + '" data-i18n="contact">CONTACT</a>',
    '      </div>',
    '      <div class="nav-bottom-row">',
    '        <div class="nav-socials active" id="navSocials">' + socialHTML + '</div>',
    '      </div>',
    '    </div>',
    /* QA #320 — 이 컬럼의 내용은 pap-header.js 로딩 후 /api/nav-menu 응답으로
       덮어씌워진다. 아래 하드코딩 5개는 API 실패 시 fallback. */
    '    <div class="nav-right-col" id="papNavRightCol">',
    '      <a href="#" onclick="' + _navGo('/community') + '" data-i18n="navCommunity" style="color:var(--pap-red)">COMMUNITY</a>',
    '      <a href="#" onclick="' + _navGo('/magazine') + '" data-i18n="navMagazine" style="color:#c9a96e">MAGAZINE</a>',
    /* EDITORIAL — on index.html (where #edAllOverlay exists) open the
       overlay directly; on any other page navigate to the home-page hash
       so pap-app.js auto-opens the overlay after landing. */
    '      <a href="/#all-editorials" onclick="event.preventDefault();_papCloseNav();if(document.getElementById(\'edAllOverlay\')&&typeof openAllEditorials===\'function\'){openAllEditorials();}else{window.location.href=\'/#all-editorials\';}" data-i18n="navEditorial">EDITORIAL</a>',
    '      <a href="#" onclick="' + _navGo('/articles') + '" data-i18n="navArticle">ARTICLE</a>',
    '      <a href="#" onclick="' + _navGo('/films') + '" data-i18n="navFilm">FILM</a>',
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
    '  <a href="/" class="logo-wrap"><img src="pap-logo.png" alt="PAP Magazine"></a>',
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
    '        <a href="/auth" data-i18n="navLogin">로그인 / 회원가입</a>',
    '        <div class="dropdown-divider"></div>',
    '        <a href="/subscribe" data-i18n="subscribe">구독하기</a>',
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
    _removeAll('header.auth-header');
    _removeAll('.nav-overlay');
    _removeAll('.pap-search-overlay');
    _removeAll('body > .lang-selector');
    _removeAll('.mp-lang');
    _removeAll('.mp-back');

    var wrapper = document.createElement('div');
    wrapper.innerHTML = headerHTML;
    var frag = document.createDocumentFragment();
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
    document.body.insertBefore(frag, document.body.firstChild);

    _afterInject();
    // QA #320 — DB 기반 nav menu 항목으로 우측 컬럼 교체.
    // 실패해도 하드코딩 fallback 이 유지되므로 조용히 처리.
    _papLoadDynamicNavMenu();
  }
  _injectHeader();

  /* QA #320 — /api/nav-menu 에서 활성 메뉴 목록을 받아 우측 컬럼 교체.
     link_url 이 '/#all-editorials' 인 경우 기존 특수 오버레이 핸들러를 재현.
     다른 URL 은 일반 _navGo() 로 처리. i18n 딕셔너리 키가 있으면 data-i18n 부착. */
  function _papLoadDynamicNavMenu(){
    var col = document.getElementById('papNavRightCol');
    if (!col) return;
    var apiBase = (window.PAP_API_BASE || '/api').replace(/\/$/, '');
    fetch(apiBase + '/nav-menu', { credentials: 'omit' })
      .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(json){
        var list = (json && json.data) || [];
        if (!list.length) return; // fallback 유지
        var styleColor = { red: 'var(--pap-red)', gold: '#c9a96e', muted: 'rgba(255,255,255,.5)', default: '' };
        var html = '';
        list.forEach(function(item){
          var url = String(item.link_url || '');
          var color = styleColor[item.style] || '';
          var styleAttr = color ? (' style="color:' + color + '"') : '';
          var i18nAttr = item.label_key ? (' data-i18n="' + item.label_key + '"') : '';
          var label = _escNav(item.label_default || '');
          var onclick;
          if (url === '/#all-editorials'){
            // EDITORIAL 특수 케이스: 홈페이지 오버레이 트리거.
            onclick = 'event.preventDefault();_papCloseNav();if(document.getElementById(\'edAllOverlay\')&&typeof openAllEditorials===\'function\'){openAllEditorials();}else{window.location.href=\'/#all-editorials\';}';
            html += '<a href="/#all-editorials" onclick="' + onclick + '"' + i18nAttr + styleAttr + '>' + label + '</a>';
          } else if (/^https?:\/\//i.test(url)){
            // 외부 URL: 새 탭.
            html += '<a href="' + _escNav(url) + '" target="_blank" rel="noopener noreferrer" onclick="_papCloseNav()"' + i18nAttr + styleAttr + '>' + label + '</a>';
          } else {
            // 내부 경로.
            html += '<a href="#" onclick="' + _navGo(url) + '"' + i18nAttr + styleAttr + '>' + label + '</a>';
          }
        });
        col.innerHTML = html;
        // i18n 재적용 (사용자가 이미 선택한 언어로).
        try { if (typeof window.applyI18n === 'function') window.applyI18n(); } catch(_){}
      })
      .catch(function(err){
        if (typeof console !== 'undefined') console.warn('[nav-menu] load failed, fallback:', err && err.message);
      });
  }
  function _escNav(s){
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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
      // QA #98 — toggle BOTH .is-active AND .active on the hamburger so
      // pages that ship their own (stale) `.hamburger.active span:...`
      // CSS still morph into an X. Without this, magazine.html (which
      // has `.hamburger.active` rules in its inline <style> but no
      // `.is-active` rules) stayed as three bars when the menu opened.
      // Pages whose CSS keys off `.is-active` (pap-styles.css, the
      // injected header style here) keep working unchanged.
      var hb = document.querySelector('.hamburger');
      if (hb) {
        if (opening) {
          hb.classList.add('is-active');
          hb.classList.add('active');
        } else {
          hb.classList.remove('is-active');
          hb.classList.remove('active');
        }
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

    /* Toggle Search.
       Prefer the legacy #searchBar (which has the full search-results
       dropdown markup + input handler bound in pap-app.js's
       searchEditorials). Fall back to the injected #papSearchOverlay
       only when the page doesn't have the legacy element (e.g. minimal
       pages like 404.html). This makes the header search button work
       identically across home + sub pages — same overlay, same handlers,
       same Enter / click behavior. */
    window._papToggleSearch = function () {
      var legacyBar = document.getElementById('searchBar');
      if (legacyBar) {
        legacyBar.classList.toggle('active');
        if (legacyBar.classList.contains('active')) {
          setTimeout(function () {
            var inp = document.getElementById('searchInput');
            if (inp) inp.focus();
          }, 300);
        } else {
          var dd = document.getElementById('searchDropdown');
          if (dd) dd.classList.remove('active');
          var inp = document.getElementById('searchInput');
          if (inp) inp.value = '';
        }
        return;
      }
      // Fallback for pages without the full search component
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
    /* Don't blindly overwrite window.toggleSearch — keep the legacy
       pap-app.js implementation in place and only set our wrapper if
       no other implementation has registered. */
    if (typeof window.toggleSearch !== 'function') {
      window.toggleSearch = window._papToggleSearch;
    }

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
      // Persist the user's locale on the server profile so the email
      // campaign cron can render newsletters in this language. Logged-
      // out visitors are skipped — their pap-lang stays in localStorage
      // and will be synced to the profile if/when they sign up.
      // Fire-and-forget: a transient network blip must not block the
      // visible UI change the user just made.
      try {
        var tok = localStorage.getItem('pap-token');
        if (tok) {
          fetch('/api/auth/language', {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang: l }),
          }).catch(function () { /* no-op */ });
        }
      } catch (_) { /* localStorage may throw in some private modes */ }
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
              '<a href="/subscribe">' + s.subscribe + '</a>' +
              '<div class="dropdown-divider"></div>' +
              '<button onclick="localStorage.removeItem(\'pap-token\');localStorage.removeItem(\'pap-user\');window.location.href=\'/\';">' + s.logout + '</button>';
          }
        }
      } catch (e) { }
    }
    _updateAuthDropdown();
  }

})();
