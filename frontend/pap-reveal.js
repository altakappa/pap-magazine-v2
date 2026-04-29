/**
 * PAP Scroll Reveal — unified fade-in-up entrance animation.
 *
 * Spec (per QA Scroll Interaction Guideline):
 *   • Type:     Fade-in + Move Up (translateY 16 → 0, opacity 0 → 1)
 *   • Duration: 0.6s
 *   • Easing:   cubic-bezier(0.22, 1, 0.36, 1)
 *   • Trigger:  IntersectionObserver, threshold 0.2, run once
 *   • Stagger:  0.08s between consecutive list items
 *   • Performance: transform + opacity only; will-change: transform
 *   • Reduced motion: animation disabled, content shown immediately
 *
 * Auto-binds to common content selectors site-wide so every page picks
 * up the same interaction without per-page wiring. Dynamic content
 * (cards rendered via JS after API fetch) can call window.papReveal
 * .refresh() to bind newly inserted nodes.
 */
(function(){
  'use strict';

  if(window.__papRevealLoaded) return;
  window.__papRevealLoaded = true;

  var DURATION = '0.6s';
  var EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
  var STAGGER_MS = 80;       // 0.08s between siblings
  var STAGGER_CAP_MS = 600;  // never wait more than 0.6s for any one item
  var THRESHOLD = 0.2;

  /* ---- Inject base CSS once ---- */
  var styleId = '__pap-reveal-style';
  if(!document.getElementById(styleId)){
    var style = document.createElement('style');
    style.id = styleId;
    /* Double-class selector (.pap-reveal.pap-reveal) bumps specificity
       to 0,2,0 — higher than any single-class card rule already in the
       site stylesheet, so our opacity/transform always wins regardless
       of cascade order. */
    style.textContent =
      '.pap-reveal.pap-reveal{' +
        'opacity:0;' +
        'transform:translateY(16px);' +
        'transition:opacity ' + DURATION + ' ' + EASING + ',transform ' + DURATION + ' ' + EASING + ';' +
        'transition-delay:var(--pap-reveal-delay,0s);' +
        'will-change:transform,opacity;' +
      '}' +
      '.pap-reveal.pap-reveal.is-in{opacity:1;transform:none;will-change:auto}' +
      '@media (prefers-reduced-motion:reduce){' +
        '.pap-reveal.pap-reveal{opacity:1;transform:none;transition:none}' +
      '}';
    document.head.appendChild(style);
  }

  /* ---- IntersectionObserver (with graceful degradation) ---- */
  var supported = typeof IntersectionObserver === 'function';
  var observer = supported ? new IntersectionObserver(function(entries){
    for(var i = 0; i < entries.length; i++){
      var e = entries[i];
      if(e.isIntersecting){
        e.target.classList.add('is-in');
        observer.unobserve(e.target);
      }
    }
  }, {threshold: THRESHOLD, rootMargin: '0px 0px -8% 0px'}) : null;

  function _observe(el){
    if(!el || el.__papObs) return;
    el.__papObs = true;
    if(supported){
      observer.observe(el);
    } else {
      // Older browsers: skip animation, show immediately
      el.classList.add('is-in');
    }
  }

  /* ---- Auto-bind selectors ----
     These cover the visible content patterns across the site. Sections
     themselves are NOT bound (avoid hiding entire chunks); only the
     individual content children inside them animate. */
  var AUTO_BIND = [
    // Home / detail row labels
    '.ed-row-label',
    '.shorts-title',
    '.fashion-section h2',

    // Home page cards (individual items inside lists)
    '.ed-row-track > .ed-row-card',
    '.fashion-grid > .fashion-card',

    // List pages (articles / films / editorials full-grid)
    '#cardGrid > .card',
    '#filmGrid > .film-card',
    '.ed-all-grid > .ed-row-card',
    '.film-all-grid > .film-all-card',
    '.art-all-grid > .art-all-card',

    // Detail page galleries (image-heavy stagger)
    '.ed-gallery-grid > .ed-gallery-item',
    '#artDetailGallery > *',

    // Sub pages: about / subscribe / contact / pullletter / business
    '.about-content > *',
    '.subscribe-section > *, .subscribe-content > *, .plan-card',
    '.contact-form > *',
    '.business-section > *, .business-content > *',
    '.pullletter-section > *',

    // Generic opt-in
    '[data-reveal]'
  ];

  /**
   * Apply .pap-reveal + per-item stagger delay to all currently matching
   * elements, then start observing them. Idempotent — safe to call again
   * after the DOM mutates.
   */
  function _bind(){
    AUTO_BIND.forEach(function(sel){
      var nodes;
      try { nodes = document.querySelectorAll(sel); }
      catch(_){ return; }
      // Group siblings under the same parent to stagger correctly even
      // when the selector spans multiple containers.
      var byParent = new Map();
      for(var i = 0; i < nodes.length; i++){
        var n = nodes[i];
        if(n.classList.contains('pap-reveal')) continue;
        var p = n.parentElement || document.body;
        if(!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(n);
      }
      byParent.forEach(function(siblings){
        for(var j = 0; j < siblings.length; j++){
          var el = siblings[j];
          el.classList.add('pap-reveal');
          var delayMs = Math.min(j * STAGGER_MS, STAGGER_CAP_MS);
          if(delayMs > 0) el.style.setProperty('--pap-reveal-delay', (delayMs/1000) + 's');
          _observe(el);
        }
      });
    });
  }

  function _start(){
    _bind();
    // Drop will-change once an element finishes animating to free GPU layers.
    document.addEventListener('transitionend', function(e){
      if(e.target.classList && e.target.classList.contains('is-in')){
        e.target.style.willChange = 'auto';
      }
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _start);
  } else {
    _start();
  }

  /* ---- Public API for dynamic content ---- */
  window.papReveal = {
    /** Re-scan the DOM and bind any newly added matching elements. */
    refresh: _bind,
    /** Manually mark and observe a single element. */
    add: function(el){
      if(!el || !el.classList) return;
      el.classList.add('pap-reveal');
      _observe(el);
    },
    /** Force the animation to fire immediately on an element. */
    show: function(el){
      if(!el || !el.classList) return;
      el.classList.add('pap-reveal','is-in');
    }
  };
})();
