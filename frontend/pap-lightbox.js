/**
 * PAP Lightbox — full-screen image viewer for editorial/article details.
 *
 * Auto-binds to gallery images via event delegation. No manual wiring
 * needed in per-page JS — including this script via a defer <script> tag
 * on any page with .ed-gallery-item, #artDetailGallery, or any element
 * marked [data-lightbox-group] is sufficient.
 *
 * Features (per QA spec):
 *  - Click image → full-screen overlay with dim backdrop opens
 *  - Top-left X button, ESC key, click outside image → close
 *  - Multi-image gallery: ‹ / › arrow buttons + ←/→ arrow keys
 *  - Mobile pinch-zoom via touch-action:pinch-zoom on the <img>
 *  - Body scroll locked while open; scroll position restored on close
 *  - Counter (n / N) shown when multiple images present
 *  - Touch swipe left/right for navigation on mobile
 *  - Preloads adjacent images for fast nav
 *  - Public API also exposed as window.papLightbox.open(urls, startIdx)
 */
(function(){
  'use strict';

  var overlay = null, imgEl = null, counterEl = null;
  var prevBtn = null, nextBtn = null, closeBtn = null, stage = null;
  var images = [], current = 0;
  var savedScrollY = 0, scrollLocked = false;
  var touchStartX = 0, touchStartY = 0, touchActive = false;

  function _ensureBuilt(){
    if(overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'pap-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '\uc774\ubbf8\uc9c0 \ud655\ub300 \ubcf4\uae30');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<button class="pap-lb-close" type="button" aria-label="\ub2eb\uae30 (Esc)">\u00d7</button>' +
      '<button class="pap-lb-prev" type="button" aria-label="\uc774\uc804 \uc774\ubbf8\uc9c0">\u2039</button>' +
      '<div class="pap-lb-stage">' +
        '<img class="pap-lb-img" alt="" draggable="false">' +
      '</div>' +
      '<button class="pap-lb-next" type="button" aria-label="\ub2e4\uc74c \uc774\ubbf8\uc9c0">\u203a</button>' +
      '<div class="pap-lb-counter" aria-live="polite"></div>';
    document.body.appendChild(overlay);

    closeBtn  = overlay.querySelector('.pap-lb-close');
    prevBtn   = overlay.querySelector('.pap-lb-prev');
    nextBtn   = overlay.querySelector('.pap-lb-next');
    stage     = overlay.querySelector('.pap-lb-stage');
    imgEl     = overlay.querySelector('.pap-lb-img');
    counterEl = overlay.querySelector('.pap-lb-counter');

    closeBtn.addEventListener('click', _close);
    prevBtn .addEventListener('click', function(e){ e.stopPropagation(); _prev(); });
    nextBtn .addEventListener('click', function(e){ e.stopPropagation(); _next(); });

    // Click on the backdrop (anywhere outside the image) closes the viewer.
    overlay.addEventListener('click', function(e){
      if(e.target === imgEl) return; // never close when clicking the image itself
      _close();
    });

    // Keyboard navigation while the viewer is open.
    document.addEventListener('keydown', function(e){
      if(!overlay.classList.contains('is-open')) return;
      if(e.key === 'Escape')      { e.preventDefault(); _close(); }
      else if(e.key === 'ArrowLeft')  { e.preventDefault(); _prev(); }
      else if(e.key === 'ArrowRight') { e.preventDefault(); _next(); }
    });

    // Touch swipe (left/right) on mobile for prev/next.
    stage.addEventListener('touchstart', function(e){
      if(e.touches.length !== 1) { touchActive = false; return; }
      touchActive = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, {passive: true});
    stage.addEventListener('touchend', function(e){
      if(!touchActive) return;
      touchActive = false;
      var t = (e.changedTouches && e.changedTouches[0]);
      if(!t) return;
      var dx = t.clientX - touchStartX;
      var dy = t.clientY - touchStartY;
      // Horizontal swipe (≥40px) wins over vertical scroll
      if(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)){
        if(dx < 0) _next(); else _prev();
      }
    }, {passive: true});
  }

  function _lockScroll(){
    if(scrollLocked) return;
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    scrollLocked = true;
  }
  function _unlockScroll(){
    if(!scrollLocked) return;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, savedScrollY);
    scrollLocked = false;
  }

  function _preload(idx){
    if(idx < 0 || idx >= images.length) return;
    var i = new Image();
    i.src = images[idx];
  }

  function _update(){
    imgEl.src = images[current];
    imgEl.alt = '\uc774\ubbf8\uc9c0 ' + (current + 1);
    var multi = images.length > 1;
    counterEl.textContent = multi ? ((current + 1) + ' / ' + images.length) : '';
    counterEl.style.display = multi ? '' : 'none';
    prevBtn.style.display = multi ? '' : 'none';
    nextBtn.style.display = multi ? '' : 'none';
    // Reset any pinch-zoom transform from previous image
    imgEl.style.transform = '';
    // Preload adjacent images
    _preload(current + 1);
    _preload(current - 1);
  }

  function _open(imgs, startIdx){
    if(!imgs || !imgs.length) return;
    _ensureBuilt();
    images = imgs.slice();
    current = Math.max(0, Math.min(startIdx | 0, images.length - 1));
    _lockScroll();
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    _update();
    // Focus close button so Esc-on-focus works on every browser
    setTimeout(function(){ closeBtn && closeBtn.focus({preventScroll:true}); }, 100);
  }
  function _close(){
    if(!overlay || !overlay.classList.contains('is-open')) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    _unlockScroll();
    // Clear src to free memory
    setTimeout(function(){ if(!overlay.classList.contains('is-open')) imgEl.src = ''; }, 350);
  }
  function _prev(){
    if(images.length <= 1) return;
    current = (current - 1 + images.length) % images.length;
    _update();
  }
  function _next(){
    if(images.length <= 1) return;
    current = (current + 1) % images.length;
    _update();
  }

  /* -------- AUTO-BINDING via event delegation --------
     Any <img> inside one of the recognized gallery containers becomes
     clickable. The container's siblings provide the gallery list for
     prev/next navigation.
     QA #237 — added #artDetailDesc + #edDetailDesc so the block-renderer
     <figure><img></figure> images in article / editorial body copy now
     also open the lightbox. Previously only the dedicated gallery grid
     was wired, so the body images appeared static. */
  var GALLERY_SELECTORS = [
    '.ed-gallery-grid',     // editorial overlay
    '#edDetailGallery',     // editorial overlay (id alias)
    '#edDetailDesc',        // editorial overlay body copy (QA #237)
    '#artDetailGallery',    // article overlay legacy gallery
    '#artDetailDesc',       // article overlay block-rendered body (QA #237)
    '.seo-gallery',         // SSR pages (editorial / film SSR fallback)
    '[data-lightbox-group]' // generic opt-in
  ].join(',');

  document.addEventListener('click', function(e){
    var img = e.target && e.target.closest && e.target.closest('img');
    if(!img) return;
    var container = img.closest(GALLERY_SELECTORS);
    if(!container) return;
    // Skip non-gallery images (avatars, icons inside the gallery for some reason)
    if(img.closest('.pap-lightbox')) return;

    e.preventDefault();
    e.stopPropagation();

    var imgs = Array.from(container.querySelectorAll('img'))
      .filter(function(i){ return i.closest('.pap-lightbox') === null; });
    var startIdx = imgs.indexOf(img);
    // Use src (highest-resolution displayed); browsers cached this already
    var urls = imgs.map(function(i){
      // Prefer data-full URL if present (allows hi-res variant)
      return i.getAttribute('data-full') || i.currentSrc || i.src;
    });
    _open(urls, startIdx);
  }, true); // capture: handle before the parent's click handlers (e.g. profile popup)

  /* Style hint: cursor:zoom-in on gallery images so users know they're
     interactive. Injected once at runtime to avoid editing every page CSS. */
  (function _injectCursor(){
    var styleId = '__pap-lightbox-cursor';
    if(document.getElementById(styleId)) return;
    var st = document.createElement('style');
    st.id = styleId;
    st.textContent =
      '.ed-gallery-grid img,#edDetailGallery img,#edDetailDesc img,' +
      '#artDetailGallery img,#artDetailDesc img,.seo-gallery img,' +
      '[data-lightbox-group] img{cursor:zoom-in}';
    document.head.appendChild(st);
  })();

  // Public API
  window.papLightbox = {
    open: _open,
    close: _close,
    prev: _prev,
    next: _next
  };
})();
