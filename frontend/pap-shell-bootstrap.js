// PAP Magazine — Shell bootstrap module (final extraction from pap-app.js
// per HARNESS_CHECKLIST.md mission 11). pap-app.js is now an empty stub —
// every previously-resident block now lives in a focused module.
//
// This file owns the cross-cutting glue that doesn't fit any single content
// or feature harness:
//   - Beta config + isBetaActive() flag (referenced by pap-subscription.js)
//   - Page loader animation (LOADER IIFE + load handler + safety unlock timer)
//   - Hero slider auto-rotation
//   - getLangText helper (single-key inline message lookup, used by Content)
//   - ESC / Backspace global hotkey — cross-overlay close dispatcher
//   - NAV (toggleNav, closeNav) — hamburger + overlay + scroll lock
//   - FASHION CAROUSEL (moveCarousel) for the home fashion-section
//   - ED CAROUSEL (moveEdCarousel, ePos)
//   - SCROLL REVEAL (.sr → .v intersection-fade)
//   - scrollEdRow (editorial-row left/right buttons)
//   - Carousel arrows initialization IIFE — wires fashion / ed-row / nf-track
//   - popstate router — restores editorial / creator / film / article / all-X
//     overlays on browser back/forward
//   - Auto language detection IIFE — applies pap-lang from localStorage
//
// Public surface (consumed cross-script via globals):
//   isBetaActive()                  pap-subscription.js, inline static HTMLs
//   getLangText(key, fallback)       Content open/close helpers
//   toggleNav() / closeNav()         inline onclick= in every page header
//   moveCarousel(d) / moveEdCarousel(d) / scrollEdRow(btn,dir)
//                                    inline onclick= on home carousels
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js                → lockScroll/unlockScroll, _papWireCarousel,
//                                   _papUpdateArrows, _papSmoothScrollBy
//   - pap-i18n.js                 → setLang, lang
//   - pap-auth.js                 → isLoggedIn (referenced indirectly via
//                                   pap-subscription.js)
//   - pap-subscription.js         → showPremiumInterstitial, isStandardOrAbove
//                                   (interstitial gates + image-protect)
//   - pap-content-* modules       → openEditorial, closeEditorial,
//                                   _openCreatorPopup_noPush, getCreatorDB,
//                                   closeFilmDetail, closeArticleDetail,
//                                   closeAllX (referenced by ESC handler +
//                                   popstate router at click time)
//
// All cross-module references resolve at click / popstate time, by which
// point every script has loaded.

// ======== BETA MODE CONFIG ========
// 베타 기간 중에는 "로그인한 회원(무료/스탠다드/프리미엄 모두 포함)"에게만 전체 콘텐츠 오픈
// 비로그인 방문자는 유료 서비스에 접근 불가 (로그인 유도)
// 베타 종료 후에는 구독 등급(free/standard/premium)에 따라 접근 차등 적용
// 날짜 형식: 'YYYY-MM-DD' (예: '2026-12-31') 또는 null (베타 무기한)
var PAP_BETA_END = '2026-06-30';   // ← 베타 종료 날짜 (2026년 6월 30일 23:59:59까지)

function isBetaActive(){
  if(!PAP_BETA_END) return true; // null이면 무기한 베타
  var now = new Date();
  var end = new Date(PAP_BETA_END + 'T23:59:59');
  return now <= end;
}

// Modal scroll lock (lockScroll/unlockScroll, _scrollLockCount, _savedScrollY)
// this file — the safety timer below references _scrollLockCount as a global.
//
// i18n (T dict, lang, setLang, _applyArticleCardI18n, _loadArticleI18n) extracted to
// modal / pagination code below reads `lang` and `T` as bare globals.

// ======== LOADER ========
(function(){
  var bg=document.getElementById('loaderBg');
  if(bg){
    var slides=document.querySelectorAll('.hero-slide-img');
    if(slides.length){
      var src=slides[Math.floor(Math.random()*slides.length)].src;
      var img=new Image();
      img.onload=function(){bg.style.backgroundImage='url('+src+')';bg.classList.add('loaded');};
      img.src=src;
    }
  }
})();
window.addEventListener('load',()=>{var _l=document.getElementById('loader');if(_l)setTimeout(()=>_l.classList.add('hidden'),800);});
setTimeout(()=>{var _l=document.getElementById('loader');if(_l)_l.classList.add('hidden');},3000);

// Safety: force unlock scroll if body is stuck after page load
setTimeout(function(){
  var bs=document.body.style;
  if(bs.overflow==='hidden' && bs.position==='fixed'){
    var noOverlay=!document.getElementById('premiumInterstitial')&&!document.querySelector('.signupPopup.active,.access-gate-overlay');
    if(noOverlay){ _scrollLockCount=0; unlockScroll(); console.warn('Scroll was stuck — force unlocked'); }
  }
},4000);

// ======== HERO SLIDER ========
// QA #242 tuning — was setInterval(..., 3000). 3 seconds is below the
// typical "comfortable read" threshold for an image-led hero, so
// consecutive slides blurred together and the cover-story text had no
// chance to register. Bumped to 10s per slide — within the 7–15s range
// most editorial publications use for cover carousels.
//
// While here, added the manual-control + accessibility hooks the QA
// ticket asked to "consider":
//   • Hover / touch pauses autoplay (cursor on the banner = the user is
//     actively looking; don't yank the slide away mid-glance).
//   • Tab visibility pauses autoplay (no point cycling slides nobody can
//     see; also avoids the jarring "skipped 5 slides while I was away"
//     effect when returning to the tab).
//   • prefers-reduced-motion stops autoplay entirely (users who opted
//     into reduced motion should not get a self-changing hero).
//   • setTimeout-loop instead of setInterval so pause/resume is exact
//     and we never queue overlapping ticks across visibility flips.
let hCur = 0;
const hSlides = document.querySelectorAll('.hero-slide');
const HERO_INTERVAL_MS = 10000; // QA #242 — was 3000
let _heroTimer = null;
let _heroPaused = false;

function heroGo(n){
  if(!hSlides.length) return;
  hSlides[hCur].classList.remove('active');
  hCur = (n + hSlides.length) % hSlides.length;
  hSlides[hCur].classList.add('active');
}
function _heroTick(){
  if(_heroPaused){ _heroTimer = null; return; }
  heroGo(hCur + 1);
  _heroTimer = setTimeout(_heroTick, HERO_INTERVAL_MS);
}
function _heroStart(){
  if(_heroTimer || _heroPaused) return;
  _heroTimer = setTimeout(_heroTick, HERO_INTERVAL_MS);
}
function _heroStop(){
  if(_heroTimer){ clearTimeout(_heroTimer); _heroTimer = null; }
}
function _heroPause(){ _heroPaused = true; _heroStop(); }
function _heroResume(){ _heroPaused = false; _heroStart(); }

if(hSlides.length){
  // Honor reduced-motion: hold on the first slide, no autoplay at all.
  var _heroReduceMotion = false;
  try { _heroReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(_){}
  if(!_heroReduceMotion){
    _heroStart();
    var _heroEl = document.getElementById('hero');
    if(_heroEl){
      // Pause on hover / touch — finger or cursor on the banner means
      // the user is engaging; don't change the slide under them.
      _heroEl.addEventListener('mouseenter', _heroPause);
      _heroEl.addEventListener('mouseleave', _heroResume);
      _heroEl.addEventListener('touchstart', _heroPause, {passive:true});
      _heroEl.addEventListener('touchend',   function(){ setTimeout(_heroResume, 400); }, {passive:true});
    }
    // Pause when the tab is hidden, resume on focus.
    document.addEventListener('visibilitychange', function(){
      if(document.hidden) _heroPause(); else _heroResume();
    });
  }
}
// Expose for debugging / future manual nav buttons.
window._papHero = { go: heroGo, pause: _heroPause, resume: _heroResume,
                    intervalMs: HERO_INTERVAL_MS };

// ======== SEARCH ========
// ======== LANG HELPER ========
function getLangText(key,fallback){var lang=localStorage.getItem('pap-lang')||'ko';var msgs={edAccessFree:{ko:'에디토리얼 전체보기는 스탠다드 이상 회원만 이용 가능합니다.',en:'Standard membership or above is required to browse all editorials.',it:'Per accedere a tutti gli editoriali è necessario un abbonamento Standard o superiore.',fr:'Un abonnement Standard ou supérieur est requis pour parcourir tous les éditoriaux.',es:'Se requiere una membresía Estándar o superior para ver todos los editoriales.',ja:'全エディトリアルの閲覧にはスタンダード以上の会員登録が必要です。',zh:'浏览所有社论需要标准会员或以上。',ru:'Для просмотра всех редакционных материалов требуется подписка Standard или выше.'}};var m=msgs[key];if(!m)return fallback||'';return m[lang]||m.en||fallback||'';}

// toggleSearch / search input listeners / searchEditorials: extracted to
// Both pap-auth.js and pap-search.js MUST be loaded before this file.
//
// The ESC/Backspace global hotkey handler below STAYS here — it closes
// search UI but ALSO closes editorial / film / article overlays and the nav,
// which belong to other harnesses. Splitting it would cross-couple them.
document.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='Backspace'){var isInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable;if(e.key==='Backspace'&&isInput)return;var _sb=document.getElementById('searchBar');if(_sb)_sb.classList.remove('active');var _sdd=document.getElementById('searchDropdown');if(_sdd)_sdd.classList.remove('active');var _ssi=document.getElementById('searchInput');if(_ssi)_ssi.value='';var _ad=document.getElementById('accountDropdown');if(_ad)_ad.classList.remove('active');closeNav();var edOv=document.getElementById('edOverlay');if(edOv&&edOv.classList.contains('active')){closeEditorial();e.preventDefault();return;}closeAllEditorials();closeAllFilms();closeAllArticles();if(document.getElementById('filmDetailOverlay'))document.getElementById('filmDetailOverlay').classList.remove('active');if(document.getElementById('artDetailOverlay'))document.getElementById('artDetailOverlay').classList.remove('active');if(e.key==='Backspace')e.preventDefault();}});

// ======== NAV ========
function toggleNav(){
  var _n=document.getElementById('navOverlay');
  if(!_n) return;
  var opening = !_n.classList.contains('active');
  _n.classList.toggle('active');

  // Hamburger ≡ ↔ X morph
  // QA #98 — toggle BOTH .is-active AND .active so pages with stale
  // page-level CSS keyed off `.hamburger.active` (e.g. magazine.html)
  // also morph into an X. Pages keyed off `.is-active` (the canonical
  // class — pap-styles.css, pap-header.js injected style) keep working
  // unchanged because we still toggle that class too.
  var hb = document.querySelector('.hamburger');
  if(hb){
    if(opening){
      hb.classList.add('is-active');
      hb.classList.add('active');
    } else {
      hb.classList.remove('is-active');
      hb.classList.remove('active');
    }
  }

  // Scroll lock
  if(opening) lockScroll();
  else unlockScroll();

  // Floating logo
  var fLogo=document.getElementById('floatingLogo');
  var heroEl=document.querySelector('.hero');
  if(fLogo){
    if(opening){
      fLogo.style.display='none';
      if(heroEl) heroEl.style.cursor='';
    } else {
      fLogo.style.display='';
    }
  }
}
function closeNav(){
  var _n=document.getElementById('navOverlay');
  if(_n && _n.classList.contains('active')) toggleNav();
}

// Carousel helpers (_papUpdateArrows, _papWireCarousel, _papSmoothScrollBy)
// below call _papSmoothScrollBy as a global at click time.

// ======== FASHION CAROUSEL ========
function moveCarousel(d){
  var t = document.getElementById('fashionTrack');
  if(!t) return;
  // Scroll by ~one card width (estimated from first child or fallback).
  var first = t.firstElementChild;
  var step = (first ? first.offsetWidth + 24 : 320);
  // Reset legacy transform if any prior state set it.
  if(t.style.transform) t.style.transform = '';
  _papSmoothScrollBy(t, d * step);
}

// ======== ED CAROUSEL ========
let ePos=0;
function moveEdCarousel(d){const t=document.getElementById('edTrack');if(!t||!t.firstElementChild)return;const w=t.firstElementChild.offsetWidth+20;ePos=Math.max(0,Math.min(ePos+d,3));t.style.transform=`translateX(-${ePos*w}px)`}

// ======== SCROLL REVEAL ========
const obs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('v')}),{threshold:.05});
document.querySelectorAll('.sr').forEach(e=>obs.observe(e));

// ======== INIT ========

// ======== TERMS & PRIVACY PAGES ========
// openPage / closePage / _legalNoticeTexts: extracted to pap-static.js
// (mission 7). _legalNoticeTexts now lives in pap-i18n.js. Both must be
// loaded before this file (already wired so via the script tag order).

// ======== EDITORIAL ROWS SCROLL ========
function scrollEdRow(btn,dir){
  var track=btn.parentElement.querySelector('.ed-row-track');
  if(track) _papSmoothScrollBy(track, dir*460);
}

// QA #239 — Single source of truth: overlay id → close function name.
// Exposed on window so per-content modules can call
// _papCloseOtherOverlays() before they open a new overlay (avoids the
// nested-layer stacking the user reported: clicking a contributor name
// inside an editorial used to leave the editorial open behind a film
// overlay behind a profile popup — three layers deep, browser-back
// chaos).
window._PAP_OVERLAY_CLOSE_MAP = {
  'edAllOverlay':       'closeAllEditorials',
  'filmAllOverlay':     'closeAllFilms',
  'artAllOverlay':      'closeAllArticles',
  'edOverlay':          'closeEditorial',
  'filmDetailOverlay':  'closeFilmDetail',
  'artDetailOverlay':   'closeArticleDetail'
};

// QA #239 v2 — close every other active SPA overlay before opening a
// new one. Each close fn already accepts a skipHistory truthy arg so
// we don't push extra history.back() calls when the caller is about
// to push its own state. Safe to call from inside an open() flow.
window._papCloseOtherOverlays = function(exceptId){
  var MAP = window._PAP_OVERLAY_CLOSE_MAP;
  Object.keys(MAP).forEach(function(id){
    if(id === exceptId) return;
    var el = document.getElementById(id);
    if(!el || !el.classList.contains('active')) return;
    try {
      var fn = window[MAP[id]];
      if(typeof fn === 'function') fn(true); // skipHistory
    } catch(_){}
  });
};

// QA #239 — Universal left-side X close + HOME icon on every overlay.
// Inject from JS so the close + home affordances stay in sync across
// six different overlay markup blocks. Skips overlays whose markup
// already includes .overlay-mini-close (idempotent re-runs OK too).
(function _papWireOverlayCloseButtons(){
  var MAP = window._PAP_OVERLAY_CLOSE_MAP;
  // QA #239 v2 — same SVG used for both wired-from-markup and JS-wired
  // home buttons so they paint identically.
  var HOME_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">' +
      '<path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5z"/>' +
    '</svg>';
  function _wire(){
    Object.keys(MAP).forEach(function(id){
      var overlay = document.getElementById(id);
      if(!overlay) return;
      var miniLeft = overlay.querySelector('.overlay-mini-left');
      if(!miniLeft) return;
      var fnName = MAP[id];
      // 1) X close (left-most). Skip if already wired in markup.
      if(!miniLeft.querySelector('.overlay-mini-close')){
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'overlay-mini-close';
        btn.setAttribute('aria-label', '닫기');
        btn.innerHTML = '&times;';
        btn.addEventListener('click', function(){
          try { if(typeof window[fnName] === 'function') window[fnName](); } catch(_){}
        });
        miniLeft.insertBefore(btn, miniLeft.firstChild);
      }
      // 2) HOME button (right after the X). Closes the overlay then
      //    routes to /. Surfaces the "1-click out" affordance the user
      //    asked for — clicking the centered PAP logo also goes home,
      //    but users don't always discover the logo is interactive.
      if(!miniLeft.querySelector('.overlay-mini-home')){
        var home = document.createElement('a');
        home.href = '/';
        home.className = 'overlay-mini-home';
        home.setAttribute('aria-label', '메인 홈으로');
        home.title = '메인 홈으로';
        home.innerHTML = HOME_SVG;
        home.addEventListener('click', function(e){
          e.preventDefault();
          try { if(typeof window[fnName] === 'function') window[fnName](true); } catch(_){}
          window.location.href = '/';
        });
        // Insert AFTER the close button (which is now firstChild).
        var closeEl = miniLeft.querySelector('.overlay-mini-close');
        if(closeEl && closeEl.nextSibling){
          miniLeft.insertBefore(home, closeEl.nextSibling);
        } else {
          miniLeft.appendChild(home);
        }
      }
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _wire);
  } else {
    _wire();
  }
})();

// Initialize unified arrow-state for every home-page horizontal carousel.
// Runs once at DOMContentLoaded; carousels added later (e.g. by API render)
// can call this again or rely on the MutationObserver inside _papWireCarousel.
(function _papInitCarouselArrows(){
  function init(){
    // Fashion section ("최신기사") — single track, fixed left/right arrows
    var fashionTrack = document.getElementById('fashionTrack');
    if(fashionTrack){
      var section = fashionTrack.closest('.fashion-section');
      var L = section && section.querySelector('.carousel-arrow.left');
      var R = section && section.querySelector('.carousel-arrow.right');
      _papWireCarousel(fashionTrack, '.carousel-arrow.left', '.carousel-arrow.right');
      // The left/right arrow query above scopes to wrap (parentElement of
      // track), but fashion uses section as the relative parent — wire by
      // direct ref too:
      if(L || R){
        function update(){ _papUpdateArrows(fashionTrack, L, R); }
        fashionTrack.addEventListener('scroll', update, {passive:true});
        window.addEventListener('resize', update);
        // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
      }
    }
    // Editorial rows — multiple tracks, each wrapped in .ed-row-wrap
    document.querySelectorAll('.ed-row-wrap').forEach(function(wrap){
      var track = wrap.querySelector('.ed-row-track');
      var left  = wrap.querySelector('.ed-row-arrow.ed-row-left');
      var right = wrap.querySelector('.ed-row-arrow.ed-row-right');
      if(!track) return;
      function update(){ _papUpdateArrows(track, left, right); }
      track.addEventListener('scroll', update, {passive:true});
      window.addEventListener('resize', update);
      var mo = new MutationObserver(update);
      try{ mo.observe(track, {childList:true, subtree:false}); }catch(_){}
      // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
    });
    // Film carousel — .nf-wrap with .nf-track inside
    document.querySelectorAll('.nf-wrap').forEach(function(wrap){
      var track = wrap.querySelector('.nf-track');
      var left  = wrap.querySelector('.nf-nav-left');
      var right = wrap.querySelector('.nf-nav-right');
      if(!track) return;
      function update(){ _papUpdateArrows(track, left, right); }
      track.addEventListener('scroll', update, {passive:true});
      window.addEventListener('resize', update);
      var mo = new MutationObserver(update);
      try{ mo.observe(track, {childList:true, subtree:false}); }catch(_){}
      // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


window.addEventListener('popstate',function(e){
  var st=e.state;
  var edOv=document.getElementById('edOverlay');
  var cpOv=document.getElementById('creatorPopup');

  // If navigating back to a creator profile state → restore creator popup
  if(st && st.creator && st.handle){
    // Close editorial overlay if open (without history manipulation)
    if(edOv && edOv.classList.contains('active')){
      edOv.classList.remove('active');
      document.body.style.overflow='';
    }
    // Restore creator popup from saved data or by handle
    if(window._lastCreatorData){
      var cr=window._lastCreatorData;
      var h=cr.handle||cr.instagram||cr.name||'';
      if(h.replace('@','').toLowerCase()===st.handle.replace('@','').toLowerCase()){
        // Re-open with saved data (no pushState)
        _openCreatorPopup_noPush(cr);
        return;
      }
    }
    // Fallback: open by handle from DB
    var db=typeof getCreatorDB==='function'?getCreatorDB():{};
    var key=st.handle.toLowerCase();
    if(db[key]){
      _openCreatorPopup_noPush(db[key]);
    } else {
      _openCreatorPopup_noPush({name:st.handle.replace('@',''),handle:st.handle,role:'Contributor',editorials:[],imgs:[]});
    }
    return;
  }

  // If navigating back to a previous editorial state → restore that editorial
  if(st && st.editorial && st.title){
    // Close creator popup if open
    var _wasCpActive = !!(cpOv && cpOv.classList.contains('active'));
    if(_wasCpActive){cpOv.classList.remove('active');unlockScroll();}
    _openEditorialInner_noPush(st.title, st.thumb||'');
    // If we just closed a creator popup that was opened ON TOP of the
    // editorial, restore the scroll position the user was at when they
    // clicked the credit. Without this they get snapped to the top
    // because _openEditorialInner_noPush ends with scrollTop=0.
    if(_wasCpActive && typeof window._papEdScrollBeforeCreator === 'number'){
      try {
        var _edOv2 = document.getElementById('edOverlay');
        if(_edOv2) _edOv2.scrollTop = window._papEdScrollBeforeCreator;
      } catch(_){}
      window._papEdScrollBeforeCreator = null;
    }
    return;
  }

  // QA #166 — film/article/list states need EXPLICIT restore handling.
  // The catch-all below "close whatever is active" mistakenly closes the
  // underlying overlay when the user dismisses a popup that sat on top
  // of it (e.g. clicking × on a creator popup that was opened from a
  // film detail's credit row). After closeCreatorPopup → history.back(),
  // popstate fires with st={film:true,idx:N} and the catch-all would
  // close the film detail because it's still .active — even though the
  // user just wanted to dismiss the popup and return to the detail view.
  //
  // The blocks below treat these states as "stay here" anchors: dismiss
  // anything that's stacked on top, but leave the target overlay alone.

  // Back to a film detail page
  if(st && st.film){
    if(cpOv && cpOv.classList.contains('active')){cpOv.classList.remove('active');unlockScroll();}
    var _fd=document.getElementById('filmDetailOverlay');
    if((!_fd || !_fd.classList.contains('active')) && typeof openFilmDetail==='function' && typeof st.idx==='number'){
      // Forward/back across a page reload — overlay is gone; re-create it.
      // openFilmDetail does replaceState when the URL hash already matches,
      // so we don't double-push history.
      openFilmDetail(st.idx);
    }
    return;
  }
  // Back to an article detail page
  if(st && st.article){
    if(cpOv && cpOv.classList.contains('active')){cpOv.classList.remove('active');unlockScroll();}
    var _ad=document.getElementById('artDetailOverlay');
    if((!_ad || !_ad.classList.contains('active')) && typeof openArticleDetail==='function' && typeof st.idx==='number'){
      openArticleDetail(st.idx);
    }
    return;
  }
  // Back to a list overlay (films-all / articles-all / editorials-all).
  // The list is still .active underneath whatever sat on top. Dismiss
  // any detail / popup that's stacked, but leave the list alone.
  // closeFilmDetail(true) etc. pass skipHistory so we don't fire a
  // second popstate by chaining history.back() in the closers.
  if(st && st.overlay){
    if(cpOv && cpOv.classList.contains('active')){cpOv.classList.remove('active');unlockScroll();}
    var _fdL=document.getElementById('filmDetailOverlay');
    if(_fdL && _fdL.classList.contains('active')){closeFilmDetail(true);}
    var _adL=document.getElementById('artDetailOverlay');
    if(_adL && _adL.classList.contains('active')){closeArticleDetail(true);}
    // Note: edOverlay is the editorial DETAIL overlay (single editorial),
    // and edAllOverlay is the editorial LIST. The list never has a detail
    // overlay opened on top of it in the same stack, so we don't touch
    // edOv here — the catch-all paths above handle editorial cases.
    return;
  }

  // Otherwise, close whatever overlay is open
  // Close creator popup first
  if(cpOv && cpOv.classList.contains('active')){
    cpOv.classList.remove('active');
    unlockScroll();
    return;
  }
  if(edOv && edOv.classList.contains('active')){
    closeEditorial(true);
    return;
  }
  // Close all-editorials overlay
  var edAll=document.getElementById('edAllOverlay');
  if(edAll && edAll.classList.contains('active')){closeAllEditorials(true);return;}
  // Close film/article overlays on back button
  var filmDet=document.getElementById('filmDetailOverlay');
  if(filmDet && filmDet.classList.contains('active')){closeFilmDetail(true);return;}
  var filmAll=document.getElementById('filmAllOverlay');
  // QA #244 — closeAllFilms / closeAllArticles now call history.back()
  // when skipHistory is false. popstate is the one place we MUST pass
  // true, otherwise we'd pop the stack twice (the browser already did
  // one pop to fire popstate).
  if(filmAll && filmAll.classList.contains('active')){closeAllFilms(true);return;}
  var artDet=document.getElementById('artDetailOverlay');
  if(artDet && artDet.classList.contains('active')){closeArticleDetail(true);return;}
  var artAll=document.getElementById('artAllOverlay');
  if(artAll && artAll.classList.contains('active')){closeAllArticles(true);return;}
});




// AUTO LANGUAGE DETECTION
// Language detection is delegated to pap-geo-lang.js (loaded before this script).
// That module handles: IP geolocation → browser/timezone fallback → user preference respect.
// Here we simply apply whatever has already been resolved in localStorage.
(function(){
  var saved = localStorage.getItem('pap-lang') || 'en';
  setLang(saved);
})();









window.artData=artData;window.filmAllData=filmAllData;








// ======== PAGINATION UTILITY ========
// Pagination component (PAP_PER_PAGE, PAP_PAGE_JUMP, buildPagination)
// and the editorial-list section below as a global.
