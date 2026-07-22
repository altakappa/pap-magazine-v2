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

  /* ── index.html (floating-logo) is NO LONGER exempt ──────────────
     Historically this script bailed on any page hosting `.floating-logo`
     (index.html) because pap-home.js's floating-logo IIFE captured a live
     reference to the ORIGINAL inline <header>'s .logo-wrap; removing that
     header left the reference stale so the logo docked at the top-left.
     That exemption is exactly what let index.html's hand-maintained header
     drift out of sync with every other page (e.g. it was missing Russian
     in the language selector). The single-source rebuild removes it:
       • index.html's inline <header>/.nav-overlay are deleted from source.
       • pap-home.js re-queries .logo-wrap LIVE (no cached stale node).
       • After injecting, we call window._papResetFloatingLogo() below so
         the floating logo docks onto the freshly injected header.
     Result: index.html uses THIS header like every other page. */

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
      /* QA(2026-07-21) — pap-styles.css 와 같은 값 유지. 한쪽만 고치면
         주입 헤더를 쓰는 페이지에서 다시 갈라진다. */
      '.header-right-item{display:inline-flex;align-items:center;justify-content:center;padding:4px;color:#fff;text-decoration:none;transition:color .2s;background:none;border:none;cursor:pointer;font-family:inherit}',
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
      /* QA(햄버거 통일) — 매거진 페이지의 nav 오버레이 연출(좌/우 컬럼 staggered
         slide-in)을 공통 주입 스타일로 승격해 전 페이지가 동일한 UX 로 통일되도록 함. */
      '.nav-overlay{position:fixed;inset:0;z-index:1500;background:#fff;opacity:0;visibility:hidden;transition:opacity .4s cubic-bezier(.23,1,.32,1),visibility .4s}',
      '.nav-overlay.active{opacity:1;visibility:visible}',
      '.nav-overlay-inner{display:flex;width:100%;height:100%;padding:80px 60px 60px}',
      '.nav-left-col{display:flex;flex-direction:column;justify-content:space-between;width:280px;flex-shrink:0;transform:translateX(-30px);opacity:0;transition:none}',
      '.nav-overlay.active .nav-left-col{transform:translateX(0);opacity:1;transition:transform .5s cubic-bezier(.23,1,.32,1) .15s,opacity .5s cubic-bezier(.23,1,.32,1) .15s}',
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
      '.nav-right-col{flex:1;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:0;transform:translateX(30px);opacity:0;transition:none}',
      '.nav-overlay.active .nav-right-col{transform:translateX(0);opacity:1;transition:transform .5s cubic-bezier(.23,1,.32,1) .25s,opacity .5s cubic-bezier(.23,1,.32,1) .25s}',
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
      /* push content below header on sub-pages.
         QA(2026-07) #24·#25·#26 — 예전엔 margin-left:0!important 이었다. 원래는
         레거시 좌측 사이드바 오프셋(.content{margin-left:220px})을 지우려는 규칙인데,
         이 선택자는 특이도가 높아 페이지의 .content{margin:0 auto} 중앙정렬까지
         덮어써 버렸다. 그 결과 구독/서브미션/풀레터처럼 max-width 가 걸린 단일
         박스 페이지가 좌측으로 치우쳤다(각 페이지가 margin-left:auto!important 로
         방어해도 이 규칙의 특이도가 더 높아 무력화됐다).
         auto 로 바꾸면 (a) 레거시 사이드바 오프셋은 그대로 제거되고
         (b) max-width 가 있는 .content 는 정상적으로 중앙정렬된다.
         max-width 가 없는 .content 는 auto 가 0 처럼 동작하므로 영향 없음. */
      '.pap-has-header:not(.pap-keep-side-nav) .content{margin-left:auto!important;margin-right:auto!important;padding-top:100px!important}',
      /* QA(2026-07-22) — margin-left:0!important 가 subscribe·submission·pullletter 의
         .footer-legal{margin:0 auto}(중앙) 좌측 auto 를 죽여 푸터가 왼쪽에 붙었다
         (실측: margin 0/400px). 원래 의도(옛 side-nav 좌측 고정 여백 상쇄)는 auto 로도
         충족되므로 중앙 정렬을 살린다. */
      '.pap-has-header:not(.pap-keep-side-nav) .footer-legal{margin-left:auto!important;margin-right:auto!important}',
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
      /* QA #328 — Unified close-button behaviour across ALL pages.
         Previously two visible close affordances co-existed when the
         overlay was open:
           1) .hamburger.is-active — 3 bars morph into ×
           2) .pap-nav-close       — dedicated X injected inside overlay
         The hamburger sat at whatever left-offset the page-specific
         header padding produced (index=20px, magazine=40px, others
         varied), so users saw the × in different positions on different
         pages, plus a second × from .pap-nav-close at (18,18). QA #328
         asks for one canonical X position + motion on every page.

         Fix: hide the hamburger completely while the overlay is open
         and let .pap-nav-close be the sole close button, pinned to
         (18,18). The hamburger's morphing animation is replaced by a
         simple fade so pages whose padding sits the ≡ off-centre don't
         reveal the morph. */
      '.pap-nav-close{position:fixed!important;top:18px!important;left:18px!important;z-index:2001!important;width:44px;height:44px;display:none;align-items:center;justify-content:center;background:none;border:none;padding:0;cursor:pointer;color:#000;-webkit-tap-highlight-color:transparent;font-family:inherit;transition:opacity .2s ease,transform .3s cubic-bezier(.65,.05,.36,1);transform:rotate(0deg)}',
      /* Reveal whenever the nav-overlay is open. Two selectors cover both
         the "X is sibling of .nav-overlay" case AND the "X is INSIDE
         .nav-overlay" case (this script injects it as a child). Both
         selectors apply !important so page CSS can not hide it. */
      '.nav-overlay.active .pap-nav-close,body:has(.nav-overlay.active) .pap-nav-close{display:flex!important;transform:rotate(90deg)}',
      '.pap-nav-close:hover{opacity:.6}',
      '.pap-nav-close svg{display:block;width:22px;height:22px;stroke:#000}',
      /* Compact spacing on phones to match the smaller header. */
      '@media(max-width:768px){.pap-nav-close{top:12px!important;left:12px!important;width:40px;height:40px}}',
      '@media(max-width:480px){.pap-nav-close{top:10px!important;left:10px!important;width:36px;height:36px}}',
      /* Hide the hamburger button while the overlay is open — .pap-nav-close
         is the sole X. `visibility:hidden` keeps the layout stable so the
         header doesn't reflow when the menu opens. `pointer-events:none`
         prevents accidental clicks landing on the invisible morph state. */
      '.nav-overlay.active ~ header .hamburger,body:has(.nav-overlay.active) header .hamburger{visibility:hidden!important;pointer-events:none!important}'
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
    '<a href="/api/ig-out?src=nav&to=profile&url=https%3A%2F%2Fwww.instagram.com%2Fpap_magazine%2F" target="_blank" rel="noopener" class="nav-social-icon" aria-label="Instagram"><svg viewBox="0 0 40 40" width="36" height="36"><defs><linearGradient id="igH" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#FFC107"/><stop offset="25%" stop-color="#F44336"/><stop offset="50%" stop-color="#E040FB"/><stop offset="75%" stop-color="#9C27B0"/><stop offset="100%" stop-color="#5B51D8"/></linearGradient></defs><rect x="4" y="4" width="32" height="32" rx="9" fill="url(#igH)"/><rect x="8" y="8" width="24" height="24" rx="6" fill="none" stroke="#fff" stroke-width="2"/><circle cx="20" cy="20" r="5.5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="28" cy="12" r="1.8" fill="#fff"/></svg></a>',
    '<a href="https://www.threads.net/@pap_magazine" target="_blank" class="nav-social-icon" aria-label="Threads"><svg viewBox="0 0 40 40" width="36" height="36"><rect x="4" y="4" width="32" height="32" rx="9" fill="#000"/><path d="M25.5 19.2c-.1-.6-.4-1.1-.8-1.6-.8-1-1.9-1.6-3.2-1.7-1.5-.2-2.8.3-3.8 1.3-.8.9-1.2 1.9-1.2 3.1 0 1.3.5 2.4 1.4 3.2.9.8 2 1.1 3.2 1 1-.1 1.9-.5 2.6-1.2.5-.6.8-1.3.8-2.1 0-.7-.2-1.3-.7-1.8-.5-.5-1.2-.7-1.9-.6-.6.1-1.1.3-1.4.8-.3.4-.4 1-.2 1.5.2.4.5.8.9 1" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg></a>',
    '<a href="https://www.tiktok.com/@pap_magazine" target="_blank" class="nav-social-icon" aria-label="TikTok"><svg viewBox="0 0 40 40" width="36" height="36"><rect x="4" y="4" width="32" height="32" rx="9" fill="#010101"/><path d="M27.3 16.5c-1.3-.9-2.2-2.3-2.3-4h-3v11.8a2.7 2.7 0 1 1-1.8-2.5v-3.1a5.7 5.7 0 1 0 4.8 5.6V18.6c1.1.8 2.5 1.2 3.9 1.2v-3c-.6 0-1.1-.1-1.6-.3z" fill="#25F4EE" transform="translate(-0.7,-0.5)"/><path d="M27.3 16.5c-1.3-.9-2.2-2.3-2.3-4h-3v11.8a2.7 2.7 0 1 1-1.8-2.5v-3.1a5.7 5.7 0 1 0 4.8 5.6V18.6c1.1.8 2.5 1.2 3.9 1.2v-3c-.6 0-1.1-.1-1.6-.3z" fill="#FE2C55" transform="translate(0.7,0.5)"/><path d="M27.3 16.5c-1.3-.9-2.2-2.3-2.3-4h-3v11.8a2.7 2.7 0 1 1-1.8-2.5v-3.1a5.7 5.7 0 1 0 4.8 5.6V18.6c1.1.8 2.5 1.2 3.9 1.2v-3c-.6 0-1.1-.1-1.6-.3z" fill="#fff"/></svg></a>'
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

  /* Sub-pages: direct navigation (no interstitial ads).
     _papBeginTransition() 는 (a) 300ms 이상 걸리면 로딩 인디케이터를 띄우고
     (b) 이미 전환 중이면 false 를 리턴해 중복 클릭을 무시한다(디바운스). */
  function _navDirect(url) {
    return 'event.preventDefault();_papCloseNav();' +
      'if(window._papBeginTransition&&!_papBeginTransition())return;' +
      'window.location.href=\'' + url + '\';';
  }
  /* Main content pages: use navigateWithInterstitial if available */
  function _navGo(url) {
    return 'event.preventDefault();_papCloseNav();' +
      'if(window._papBeginTransition&&!_papBeginTransition())return;' +
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
    /* QA #327 — 하드코딩된 hex 를 사용 (var(--pap-red) 를 정의하지 않는 페이지에서
       COMMUNITY 가 회색으로 렌더링되던 버그 fix. magazine.html 등 pap-styles.css 를
       링크하지 않은 페이지에서 CSS 변수가 비어있어 fallback 색으로 렌더링됨). */
    '      <a href="#" onclick="' + _navGo('/community') + '" data-i18n="navCommunity" style="color:#891717">COMMUNITY</a>',
    '      <a href="#" onclick="' + _navGo('/magazine') + '" data-i18n="navMagazine" style="color:#c9a96e">MAGAZINE</a>',
    /* EDITORIAL — on index.html (where #edAllOverlay exists) open the
       overlay directly; on any other page navigate to the home-page hash
       so pap-app.js auto-opens the overlay after landing. */
    '      <a href="#" onclick="' + _navGo('/editorial') + '" data-i18n="navEditorial">EDITORIAL</a>',
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
    /* QA(2026-07-21) — 절대경로여야 한다. 상대경로 'pap-logo.png' 는
       중첩 경로 페이지(/en/article/{slug}, /ja/article/{slug} 등)에서
       /en/article/pap-logo.png 로 해석돼 404 가 나고, 로고 자리에 alt
       텍스트만 남았다(실측: naturalWidth 0). 헤더는 모든 경로에 주입되므로
       경로 깊이에 의존하면 안 된다. */
    '  <a href="/" class="logo-wrap"><img src="/pap-logo.png" alt="PAP Magazine"></a>',
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
    // QA #328 — Safety net: if any page still has a stale/legacy
    // .nav-overlay lingering without the .pap-nav-close child (older
    // static HTML that races the pap-header inject), inject a close
    // button into every overlay found so the close affordance is
    // guaranteed. Idempotent — bails when a close already exists.
    _papEnsureNavClose();
    // Single-source rebuild — dock index.html's floating logo onto the
    // freshly injected header. pap-home.js runs BEFORE this file, so its
    // floating-logo IIFE initialised while .logo-wrap did not yet exist;
    // _papResetFloatingLogo() re-reads the live .logo-wrap and repositions
    // the logo to the header centre. Guarded + deferred so layout is ready.
    _papDockFloatingLogo();
  }
  _injectHeader();

  function _papDockFloatingLogo(){
    if (!document.getElementById('floatingLogo')) return;
    // 2026-07-22 (QA: 메인홈 로고 중첩 재발) — 이 페이지엔 마우스 추종 '플로팅 로고'가
    // 있으므로, 헤더가 주입한 자체 정적 로고(.logo-wrap img)를 숨겨 이중 노출을 막는다.
    // 헤더 개편(v25)으로 index.html 예외가 사라지며 헤더가 홈에도 자기 로고를 그리기
    // 시작해 플로팅 로고와 같은 자리에 겹쳐 보였다. visibility:hidden 으로 .logo-wrap
    // 레이아웃 박스는 유지 → getHeaderLogoPos(.logo-wrap 측정) 도킹 좌표가 정확하다.
    // (모바일도 in-header 플로팅 로고가 보이므로 로고가 사라지지 않는다.)
    try {
      var _hdrLogoImg = document.querySelector('header.header .logo-wrap img');
      if (_hdrLogoImg) _hdrLogoImg.style.visibility = 'hidden';
    } catch (_) {}
    function dock(){
      if (typeof window._papResetFloatingLogo === 'function') {
        try { window._papResetFloatingLogo(); } catch (_) {}
      }
    }
    // rAF: after the injected header has been laid out this frame.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(dock);
    else setTimeout(dock, 0);
    // Belt-and-suspenders: also re-dock once fonts/images settle (the logo
    // image height can shift the header-centre by a couple of pixels).
    window.addEventListener('load', dock);
  }

  function _papEnsureNavClose(){
    var overlays = document.querySelectorAll('.nav-overlay');
    for (var i = 0; i < overlays.length; i++){
      var ov = overlays[i];
      if (ov.querySelector('.pap-nav-close')) continue;
      var btn = document.createElement('button');
      btn.className = 'pap-nav-close';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Close menu');
      btn.onclick = function(){ if (typeof _papCloseNav === 'function') _papCloseNav(); };
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';
      ov.insertBefore(btn, ov.firstChild);
    }
  }

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
        // QA #327 — 하드코딩된 hex 사용. CSS 변수(var(--pap-red))는
        // pap-styles.css 를 링크하지 않은 페이지(magazine.html 등)에서
        // 정의되지 않아 브라우저가 fallback 컬러(회색 등)로 렌더링해서
        // 페이지마다 COMMUNITY 색상이 달라 보이던 이슈 fix.
        var styleColor = { red: '#891717', gold: '#c9a96e', muted: 'rgba(255,255,255,.5)', default: '' };
        var html = '';
        list.forEach(function(item){
          var url = String(item.link_url || '');
          var color = styleColor[item.style] || '';
          var styleAttr = color ? (' style="color:' + color + '"') : '';
          var i18nAttr = item.label_key ? (' data-i18n="' + item.label_key + '"') : '';
          var label = _escNav(item.label_default || '');
          var onclick;
          if (url === '/#all-editorials' || url === '/editorial'){
            // QA(2026-07) #11 — EDITORIAL 을 다른 메뉴 항목과 동일하게 /editorial 로
            // 이동시킨다. 예전엔 홈에서 openAllEditorials()(회원전용 전체보기)를 열어
            // 비회원이 alert+/subscribe 로 튕겨 "콘텐츠 미노출"처럼 보였고, 페이지마다
            // 동작이 달라 불일치했다. 이제 _navGo 로 통일 → 모든 페이지에서 에디토리얼
            // 콘텐츠로 이동(비회원도 볼 수 있음).
            onclick = _navGo('/editorial');
            html += '<a href="#" onclick="' + onclick + '"' + i18nAttr + styleAttr + '>' + label + '</a>';
          } else if (/^https?:\/\//i.test(url)){
            // 외부 URL: 새 탭.
            html += '<a href="' + _escNav(url) + '" target="_blank" rel="noopener noreferrer" onclick="_papCloseNav()"' + i18nAttr + styleAttr + '>' + label + '</a>';
          } else {
            // 내부 경로.
            html += '<a href="#" onclick="' + _navGo(url) + '"' + i18nAttr + styleAttr + '>' + label + '</a>';
          }
        });
        col.innerHTML = html;
        /* QA(2026-07-21) 우측 메뉴만 영문으로 뜨던 문제 —
           여기서 window.applyI18n() 을 부르고 있었는데 그런 함수는 이 코드베이스
           어디에도 없다. typeof 가드가 조용히 건너뛰어 아무 일도 일어나지 않았고,
           API 가 준 label_default(영문)가 그대로 남았다.

           증상이 페이지마다 달라 보인 건 경쟁 조건 때문이다. 헤더 주입 직후의
           _papApplyHeaderI18n(saved) 는 하드코딩 폴백 마크업을 번역해 두는데,
           그 뒤 이 fetch 가 도착하면 통째로 영문으로 갈아끼운다.
             · API 가 느리거나 실패 → 번역된 폴백이 살아남아 한글
             · API 가 캐시로 즉시 도착 → 영문으로 교체된 뒤 그대로
           "커뮤니티가 처음엔 한글인데 다른 페이지 갔다 오면 영문 고정"이 정확히
           이 순서 차이다(재방문 시 응답이 캐시에서 즉시 온다).

           헤더가 그린 DOM 은 헤더가 번역한다. _hdrT 에 우측 5개 키가 모두 있다. */
        try {
          var _lang = (typeof window._papCurrentLang === 'function')
            ? window._papCurrentLang() : null;
          if (_lang && typeof window._papApplyHeaderI18n === 'function') {
            window._papApplyHeaderI18n(_lang);
          }
        } catch(_){}
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

  /* ================================================================
     3.5 전역 페이지 전환 로딩 인디케이터 (개선요청 2026-07-16)
     ----------------------------------------------------------------
     콘텐츠 증가로 메뉴 클릭 후 다음 페이지 응답까지 체감 지연이 있는데
     피드백이 없어 사용자가 반복 클릭한다. 전 페이지 공통(pap-header.js)으로
     상단 프로그레스바 + 스피너를 주입하고:
       - 전환이 300ms 이상 걸릴 때만 노출(빠른 전환의 깜빡임 방지)
       - 전환 중 재클릭은 무시(_papBeginTransition 이 false 리턴 → 핸들러 return)
       - 인터스티셜 광고(#premiumInterstitial)가 떠 있으면 스피너를 띄우지 않음
         (광고 자체가 진행 피드백이고, 스피너의 클릭 차단이 스킵 버튼을 가리는
          것도 방지)
     풀페이지 네비게이션이므로 새 페이지가 로드되면 이 오버레이는 함께 파괴된다.
     bfcache 뒤로가기 복귀 시엔 pageshow 로 강제 해제. ================ */
  function _papInitPageLoading() {
    if (!document.body || document.getElementById('papPageLoading')) return;

    if (!document.getElementById('pap-page-loading-css')) {
      var pls = document.createElement('style');
      pls.id = 'pap-page-loading-css';
      pls.textContent = [
        /* z-index 99990: nav-overlay(≤9000)·검색 위, 인터스티셜(99999) 아래 */
        '#papPageLoading{position:fixed;inset:0;z-index:99990;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s ease}',
        /* .show 일 때만 보이고 pointer-events:auto 로 중복 클릭을 물리 차단 */
        '#papPageLoading.show{opacity:1;visibility:visible;pointer-events:auto}',
        '#papPageLoading .ppl-scrim{position:absolute;inset:0;background:rgba(0,0,0,.15)}',
        /* 상단 인디터미넌트 프로그레스바(브랜드 레드→골드) */
        '#papPageLoading .ppl-bar{position:absolute;top:0;left:0;right:0;height:3px;overflow:hidden;background:rgba(0,0,0,.08)}',
        '#papPageLoading .ppl-bar::before{content:"";position:absolute;top:0;height:100%;width:42%;left:-42%;background:linear-gradient(90deg,transparent,#891717 35%,#c9a96e 70%,transparent);animation:pplSlide 1.05s cubic-bezier(.4,0,.2,1) infinite}',
        '@keyframes pplSlide{0%{left:-42%}60%{left:100%}100%{left:100%}}',
        /* 중앙 스피너 — 어떤 배경(흑/백)에서도 보이도록 어두운 카드 위에 흰 스피너 */
        '#papPageLoading .ppl-spin{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:66px;height:66px;background:rgba(18,18,18,.82);border-radius:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 30px rgba(0,0,0,.35)}',
        '#papPageLoading .ppl-spin i{display:block;width:30px;height:30px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:pplSpin .7s linear infinite}',
        '@keyframes pplSpin{to{transform:rotate(360deg)}}',
        /* 접근성: 모션 최소화 선호 시 회전만 유지, 슬라이드 완화 */
        '@media(prefers-reduced-motion:reduce){#papPageLoading .ppl-bar::before{animation-duration:1.8s}}'
      ].join('\n');
      document.head.appendChild(pls);
    }

    var el = document.createElement('div');
    el.id = 'papPageLoading';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Loading');
    el.innerHTML =
      '<div class="ppl-scrim"></div>' +
      '<div class="ppl-bar"></div>' +
      '<div class="ppl-spin"><i></i></div>';
    document.body.appendChild(el);

    var _revealTimer = null;   // 300ms 지연 후 노출
    var _safetyTimer = null;   // 전환이 끝나지 않을 때(취소 등) 강제 해제

    window._papBeginTransition = function () {
      // 이미 전환 중이면 false → 호출부에서 중복 네비게이션 차단(디바운스)
      if (window._papNavigating) return false;
      window._papNavigating = true;
      _revealTimer = setTimeout(function () {
        // 인터스티셜 광고가 떠 있으면 스피너를 띄우지 않는다(광고가 곧 피드백)
        if (document.getElementById('premiumInterstitial')) return;
        var n = document.getElementById('papPageLoading');
        if (n) n.classList.add('show');
      }, 300);
      // 20s 안에 실제 이동이 없으면(취소/실패) 잠금 해제 — 정상적인 느린
      // 전환은 그 전에 새 페이지 로드로 오버레이가 파괴되므로 영향 없음.
      _safetyTimer = setTimeout(function () { window._papEndTransition(); }, 20000);
      return true;
    };

    window._papEndTransition = function () {
      window._papNavigating = false;
      if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = null; }
      if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }
      var n = document.getElementById('papPageLoading');
      if (n) n.classList.remove('show');
    };

    // bfcache 뒤로/앞으로 복귀 시 남아있던 로딩 상태를 초기화
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) window._papEndTransition();
    });

    // 전역 링크 위임 — 메뉴 외 일반 링크(로고·카드·푸터 등)의 풀페이지 이동에도
    // 로딩 인디케이터를 붙인다. 버블 단계에서 실행되므로, onclick 이
    // preventDefault() 한 링크(SPA 오버레이 열기·본 메뉴 핸들러)는 자동 제외된다.
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      if (a.target && a.target !== '' && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      var raw = a.getAttribute('href') || '';
      if (!raw || raw.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(raw)) return;
      var dest;
      try { dest = new URL(a.href, location.href); } catch (_) { return; }
      if (dest.origin !== location.origin) return;
      // 동일 URL 이거나 해시만 다른 경우는 실제 전환 아님
      if (dest.href === location.href) return;
      if (dest.pathname === location.pathname && dest.search === location.search && dest.hash) return;
      if (window._papBeginTransition) window._papBeginTransition();
    }, false);
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

    /* QA(햄버거 강제 이동) — index.html/articles.html 의 풀스크린 SPA 오버레이
       (에디토리얼·필름·아티클 목록/상세, z-index 3000~8500)가 열린 상태에서 그
       오버레이의 mini-header 햄버거/검색을 누르면, 예전엔 오버레이를 먼저
       closeAll…()/closeXxxDetail() 로 닫아야 nav(1500)·searchBar(2000)가 보였고,
       그 close 가 history.back() 을 호출해 /editorial → 홈으로 강제 이동하는
       버그가 있었다(동시에 메뉴가 열려 "홈으로 튕기면서 메뉴 열림"). 이제
       오버레이를 닫지 않고 nav/search 를 그 오버레이 위(9000)로 끌어올려
       "현재 페이지 위에 메뉴만" 열리게 한다. 오버레이가 없으면 기본값으로
       되돌린다(홈 UX 불변). */
    function _papFullscreenOverlayOpen() {
      return document.querySelector(
        '#edAllOverlay.active,#filmAllOverlay.active,#artAllOverlay.active,' +
        '#edOverlay.active,#filmDetailOverlay.active,#artDetailOverlay.active'
      );
    }

    /* Toggle Nav */
    window._papToggleNav = function () {
      var n = document.getElementById('navOverlay');
      if (!n) return;
      var opening = !n.classList.contains('active');
      // Raise above any open SPA overlay when opening; restore default
      // otherwise. Not touched on close — nav is hidden so a stale z-index
      // is harmless, the fade-out stays visible above the overlay, and the
      // next open recomputes the value.
      if (opening) n.style.zIndex = _papFullscreenOverlayOpen() ? '9000' : '';
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
      // index.html — hide the floating hero logo while the white menu is
      // open (it would otherwise sit on top of the overlay), restore on
      // close. No-op on every other page (no #floatingLogo present).
      var fLogo = document.getElementById('floatingLogo');
      if (fLogo) fLogo.style.display = opening ? 'none' : '';
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
        var _openingBar = !legacyBar.classList.contains('active');
        // Same fix as the hamburger: float the search bar above an open
        // SPA overlay instead of closing it (which used to history.back()
        // → home). searchBar is z-index 2000; raise to 9000 when needed.
        if (_openingBar) legacyBar.style.zIndex = _papFullscreenOverlayOpen() ? '9000' : '';
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
      if (!o.classList.contains('active')) o.style.zIndex = _papFullscreenOverlayOpen() ? '9000' : '';
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

    /* QA(2026-07-22) — 폴백 오버레이의 검색 "제출" 핸들러.
       SSR 페이지(에디토리얼/아티클/필름 목록·상세 등)는 legacy #searchBar 가
       없어 #papSearchOverlay 폴백이 열리는데, 입력창(#papSearchInput)에
       핸들러가 전혀 없어서 "검색창은 열리는데 입력해도 아무 일도 안 일어나는"
       상태였다(QA 보고 그대로 — 라이브 실측: overlayOpens true, onkeydown null).
       Enter 시 통합 결과 페이지 /search?q=… 로 보낸다 — 홈(legacy 드롭다운)과
       달리 폴백은 페이지 이동형 검색으로 전 페이지 동일 플로우를 보장한다. */
    (function () {
      var inp = document.getElementById('papSearchInput');
      if (!inp || inp._papSearchBound) return;
      inp._papSearchBound = true;
      inp.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var q = String(inp.value || '').trim();
        if (!q) return;
        window.location.href = '/search?q=' + encodeURIComponent(q);
      });
    })();

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
    /* QA(2026-07-21) — SSR 상세 페이지의 언어 처리.
       ────────────────────────────────────────────────────────────────
       기사·에디토리얼 상세는 SSR 이 곧 화면이고, 서버가 URL 접두어
       (/en/article/…, /ja/article/… )로 언어를 정해 렌더한다.
       그런데 헤더 선택기는 localStorage 만 보고 UI 문자열만 바꿔서
         · /en/article/… 에 있어도 선택기엔 "한국어" 가 떠 있고
         · 언어를 바꿔도 본문은 서버가 그린 그대로 → "변화 없음"
       이었다(QA 보고 그대로). URL 이 실제 언어이므로 URL 을 진실로 삼는다.

       SSR 이 실제로 렌더하는 언어만 이동 대상에 넣는다. vercel.json 의
       rewrite 가 it|fr|es|ja 만 받으므로 zh/ru/de 로 이동하면 404 가 난다
       — 그 언어들은 기존처럼 UI 문자열만 바꾼다. */
    var PAP_SEO_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja'];
    function _papSeoPath() {
      // /article/{slug} | /{lang}/article/{slug} (editorial 도 동일)
      return location.pathname.match(/^\/(?:([a-z]{2})\/)?(article|editorial)\/(.+?)\/?$/);
    }
    function _papIsSeoDetail() {
      return !!(document.querySelector('main.seo-content') && _papSeoPath());
    }
    /** 현재 페이지의 "실제" 언어 — SSR 상세면 URL 접두어, 아니면 저장값. */
    window._papCurrentLang = function () {
      var m = _papIsSeoDetail() ? _papSeoPath() : null;
      if (m) return m[1] || 'ko';
      return localStorage.getItem('pap-lang') || 'ko';
    };
    /** 언어 전환 시 이동할 URL. 이동이 필요 없으면 null. */
    window._papSeoLangHref = function (lang) {
      if (PAP_SEO_LANGS.indexOf(lang) === -1) return null;   // SSR 미지원 언어
      var m = _papIsSeoDetail() ? _papSeoPath() : null;
      if (!m) return null;
      var cur = m[1] || 'ko';
      if (lang === cur) return null;
      var tail = m[2] + '/' + m[3];
      return lang === 'ko' ? '/' + tail : '/' + lang + '/' + tail;
    };

    var saved = window._papCurrentLang();
    // URL 이 언어를 정하는 페이지에서는 저장값도 URL 에 맞춰 둔다 —
    // 안 그러면 다음 페이지로 넘어갈 때 언어가 되돌아간다.
    try { localStorage.setItem('pap-lang', saved); } catch (_) {}
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
      /* QA(2026-07-21) — SSR 상세에서는 UI 문자열만 바꿔도 본문이 그대로다.
         해당 언어 URL 로 이동해 서버가 다시 렌더하게 한다. 선택값을 먼저
         저장해 두어야 이동한 페이지에서 선택기가 맞게 뜬다. */
      var _navTo = (typeof window._papSeoLangHref === 'function') ? window._papSeoLangHref(l) : null;
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

      /* 마지막에 이동한다 — 위의 프로필 언어 동기화(뉴스레터 언어에 쓰인다)와
         localStorage 저장이 먼저 일어나야 하기 때문. 조기 return 하면 그
         부수효과들이 통째로 건너뛰어진다. */
      if (_navTo) location.href = _navTo;
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

    /* 전역 페이지 전환 로딩 인디케이터 설치 (전 페이지 공통) */
    _papInitPageLoading();
  }

})();
